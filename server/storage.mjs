import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_REPORT_STYLE,
  DEFAULT_SUMMARY_TEMPLATE,
  SUMMARY_TEMPLATE_VERSION,
  normalizeReportStyle,
  normalizeSummaryTemplateId,
} from "./summary-templates.mjs";
import { cleanTranscriptText, replaceTranscriptText } from "./transcript-cleaning.mjs";

export class MeetingStorage {
  constructor(dataRoot = path.resolve("data")) {
    this.dataRoot = dataRoot;
    mkdirSync(dataRoot, { recursive: true });
    this.db = new DatabaseSync(path.join(dataRoot, "shiyin.sqlite"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        audio_path TEXT,
        summary_json TEXT,
        live_summary_json TEXT,
        error TEXT,
        summary_template TEXT NOT NULL DEFAULT 'meeting-minutes',
        template_version INTEGER NOT NULL DEFAULT 1,
        report_style TEXT NOT NULL DEFAULT 'detailed',
        filler_filter_enabled INTEGER NOT NULL DEFAULT 0,
        summary_stale INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS speakers (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        display_name TEXT NOT NULL,
        color TEXT NOT NULL,
        centroid_json TEXT,
        sample_count INTEGER NOT NULL DEFAULT 0,
        manually_named INTEGER NOT NULL DEFAULT 0,
        UNIQUE(meeting_id, label)
      );
      CREATE TABLE IF NOT EXISTS segments (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER,
        pause_after_ms INTEGER,
        text TEXT NOT NULL,
        speaker_id TEXT REFERENCES speakers(id) ON DELETE SET NULL,
        source TEXT NOT NULL,
        confidence REAL,
        words_json TEXT,
        edited_text TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(meeting_id, seq)
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transcript_edits (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        find_text TEXT NOT NULL,
        replacement_text TEXT NOT NULL,
        changes_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        undone_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_segments_meeting_seq ON segments(meeting_id, seq);
      CREATE INDEX IF NOT EXISTS idx_speakers_meeting ON speakers(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_meeting ON jobs(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_transcript_edits_meeting ON transcript_edits(meeting_id, created_at);
    `);
    const meetingColumns = new Set(
      this.db.prepare("PRAGMA table_info(meetings)").all().map((column) => column.name),
    );
    if (!meetingColumns.has("summary_template")) {
      this.db.exec("ALTER TABLE meetings ADD COLUMN summary_template TEXT NOT NULL DEFAULT 'meeting-minutes'");
    }
    if (!meetingColumns.has("template_version")) {
      this.db.exec("ALTER TABLE meetings ADD COLUMN template_version INTEGER NOT NULL DEFAULT 1");
    }
    if (!meetingColumns.has("report_style")) {
      this.db.exec("ALTER TABLE meetings ADD COLUMN report_style TEXT NOT NULL DEFAULT 'detailed'");
    }
    if (!meetingColumns.has("live_summary_json")) {
      this.db.exec("ALTER TABLE meetings ADD COLUMN live_summary_json TEXT");
    }
    if (!meetingColumns.has("filler_filter_enabled")) {
      this.db.exec("ALTER TABLE meetings ADD COLUMN filler_filter_enabled INTEGER NOT NULL DEFAULT 0");
    }
    if (!meetingColumns.has("summary_stale")) {
      this.db.exec("ALTER TABLE meetings ADD COLUMN summary_stale INTEGER NOT NULL DEFAULT 0");
    }
    const segmentColumns = new Set(
      this.db.prepare("PRAGMA table_info(segments)").all().map((column) => column.name),
    );
    if (!segmentColumns.has("edited_text")) {
      this.db.exec("ALTER TABLE segments ADD COLUMN edited_text TEXT");
    }
  }

  createMeeting(title = "未命名会议", options = {}) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const summaryTemplate = normalizeSummaryTemplateId(options.summaryTemplate);
    const reportStyle = normalizeReportStyle(options.reportStyle);
    const templateVersion = Number.isInteger(options.templateVersion)
      ? options.templateVersion
      : SUMMARY_TEMPLATE_VERSION;
    const directory = path.join(this.dataRoot, "meetings", id);
    mkdirSync(directory, { recursive: true });
    this.db.prepare(`
      INSERT INTO meetings
      (id, title, status, created_at, started_at, summary_template, template_version, report_style)
      VALUES (?, ?, 'recording', ?, ?, ?, ?, ?)
    `).run(id, title, now, now, summaryTemplate, templateVersion, reportStyle);
    return this.getMeeting(id);
  }

  getMeeting(id) {
    const meeting = this.db.prepare("SELECT * FROM meetings WHERE id = ?").get(id);
    if (!meeting) return null;
    return this.hydrateMeeting(meeting);
  }

  listMeetings() {
    return this.db.prepare("SELECT * FROM meetings ORDER BY started_at DESC").all()
      .map((meeting) => this.hydrateMeeting(meeting, false));
  }

  hydrateMeeting(meeting, includeDetails = true) {
    const value = {
      id: meeting.id,
      title: meeting.title,
      status: meeting.status,
      createdAt: meeting.created_at,
      startedAt: meeting.started_at,
      endedAt: meeting.ended_at,
      durationMs: meeting.duration_ms,
      audioPath: meeting.audio_path,
      summary: meeting.summary_json ? JSON.parse(meeting.summary_json) : null,
      liveSummary: meeting.live_summary_json ? JSON.parse(meeting.live_summary_json) : null,
      error: meeting.error,
      summaryTemplate: normalizeSummaryTemplateId(meeting.summary_template || DEFAULT_SUMMARY_TEMPLATE),
      templateVersion: Number(meeting.template_version || SUMMARY_TEMPLATE_VERSION),
      reportStyle: normalizeReportStyle(meeting.report_style || DEFAULT_REPORT_STYLE),
      fillerFilterEnabled: Boolean(meeting.filler_filter_enabled),
      summaryStale: Boolean(meeting.summary_stale),
    };
    if (!includeDetails) return value;
    value.speakers = this.listSpeakers(meeting.id);
    value.segments = this.listSegments(meeting.id).map((segment) => ({
      ...segment,
      cleanedText: value.fillerFilterEnabled ? cleanTranscriptText(segment.text) : segment.text,
    }));
    value.jobs = this.listJobs(meeting.id);
    value.canUndoTranscriptEdit = Boolean(this.latestTranscriptEdit(meeting.id));
    return value;
  }

  updateMeeting(id, patch) {
    const map = {
      title: "title",
      status: "status",
      endedAt: "ended_at",
      durationMs: "duration_ms",
      audioPath: "audio_path",
      error: "error",
      summaryTemplate: "summary_template",
      templateVersion: "template_version",
      reportStyle: "report_style",
    };
    const entries = Object.entries(patch).filter(([key]) => map[key]);
    if (entries.length) {
      const sql = `UPDATE meetings SET ${entries.map(([key]) => `${map[key]} = ?`).join(", ")} WHERE id = ?`;
      this.db.prepare(sql).run(...entries.map(([, value]) => value), id);
    }
    return this.getMeeting(id);
  }

  saveSummary(meetingId, summary) {
    this.db.prepare("UPDATE meetings SET summary_json = ?, summary_stale = 0 WHERE id = ?")
      .run(JSON.stringify(summary), meetingId);
  }

  saveLiveSummary(meetingId, summary) {
    this.db.prepare("UPDATE meetings SET live_summary_json = ? WHERE id = ?")
      .run(summary ? JSON.stringify(summary) : null, meetingId);
  }

  addSegment(meetingId, segment) {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO segments
      (id, meeting_id, seq, start_ms, end_ms, pause_after_ms, text, speaker_id, source, confidence, words_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      meetingId,
      segment.seq,
      segment.startMs,
      segment.endMs ?? null,
      segment.pauseAfterMs ?? null,
      segment.text,
      segment.speakerId ?? null,
      segment.source || "realtime",
      segment.confidence ?? null,
      segment.words ? JSON.stringify(segment.words) : null,
      now,
    );
    return this.getSegment(id);
  }

  getSegment(id) {
    const row = this.db.prepare("SELECT * FROM segments WHERE id = ?").get(id);
    return row ? this.hydrateSegment(row) : null;
  }

  listSegments(meetingId) {
    return this.db.prepare("SELECT * FROM segments WHERE meeting_id = ? ORDER BY seq").all(meetingId)
      .map((row) => this.hydrateSegment(row));
  }

  hydrateSegment(row) {
    return {
      id: row.id,
      meetingId: row.meeting_id,
      seq: row.seq,
      startMs: row.start_ms,
      endMs: row.end_ms,
      pauseAfterMs: row.pause_after_ms,
      text: row.edited_text ?? row.text,
      originalText: row.text,
      editedText: row.edited_text,
      cleanedText: row.edited_text ?? row.text,
      speakerId: row.speaker_id,
      source: row.source,
      confidence: row.confidence,
      words: row.words_json ? JSON.parse(row.words_json) : [],
      createdAt: row.created_at,
    };
  }

  setPauseAfter(segmentId, pauseMs) {
    this.db.prepare("UPDATE segments SET pause_after_ms = ? WHERE id = ?").run(Math.max(0, pauseMs), segmentId);
  }

  replaceCorrectedSegments(meetingId, segments) {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM segments WHERE meeting_id = ?").run(meetingId);
      this.db.prepare("DELETE FROM transcript_edits WHERE meeting_id = ?").run(meetingId);
      for (const segment of segments) this.addSegment(meetingId, { ...segment, source: "corrected" });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  setFillerFilterEnabled(meetingId, enabled) {
    this.db.prepare("UPDATE meetings SET filler_filter_enabled = ?, summary_stale = 1 WHERE id = ?")
      .run(enabled ? 1 : 0, meetingId);
    return this.getMeeting(meetingId);
  }

  latestTranscriptEdit(meetingId) {
    return this.db.prepare(`
      SELECT * FROM transcript_edits
      WHERE meeting_id = ? AND undone_at IS NULL
      ORDER BY rowid DESC LIMIT 1
    `).get(meetingId) || null;
  }

  replaceTranscriptText(meetingId, search, replacement, options = {}) {
    const segments = this.listSegments(meetingId);
    const changes = [];
    let count = 0;
    for (const segment of segments) {
      const result = replaceTranscriptText(segment.text, search, replacement, options);
      if (!result.count) continue;
      count += result.count;
      changes.push({
        id: segment.id,
        before: segment.editedText,
        after: result.text === segment.originalText ? null : result.text,
      });
    }
    if (!changes.length) return { meeting: this.getMeeting(meetingId), count: 0 };

    const editId = randomUUID();
    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      const update = this.db.prepare("UPDATE segments SET edited_text = ? WHERE id = ? AND meeting_id = ?");
      for (const change of changes) update.run(change.after, change.id, meetingId);
      this.db.prepare(`
        INSERT INTO transcript_edits
        (id, meeting_id, find_text, replacement_text, changes_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(editId, meetingId, search, replacement, JSON.stringify(changes), now);
      this.db.prepare("UPDATE meetings SET summary_stale = 1 WHERE id = ?").run(meetingId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { meeting: this.getMeeting(meetingId), count, editId };
  }

  undoLastTranscriptEdit(meetingId) {
    const edit = this.latestTranscriptEdit(meetingId);
    if (!edit) return { meeting: this.getMeeting(meetingId), restored: 0 };
    const changes = JSON.parse(edit.changes_json);
    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      const update = this.db.prepare("UPDATE segments SET edited_text = ? WHERE id = ? AND meeting_id = ?");
      for (const change of changes) update.run(change.before ?? null, change.id, meetingId);
      this.db.prepare("UPDATE transcript_edits SET undone_at = ? WHERE id = ?").run(now, edit.id);
      this.db.prepare("UPDATE meetings SET summary_stale = 1 WHERE id = ?").run(meetingId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { meeting: this.getMeeting(meetingId), restored: changes.length };
  }

  ensureSpeaker(meetingId, label, centroid = null) {
    const existing = this.db.prepare("SELECT * FROM speakers WHERE meeting_id = ? AND label = ?").get(meetingId, label);
    if (existing) return this.hydrateSpeaker(existing);
    const palette = ["green", "violet", "amber", "blue", "rose", "teal"];
    const number = Number(label.match(/\d+/)?.[0] || 1);
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO speakers (id, meeting_id, label, display_name, color, centroid_json, sample_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, meetingId, label, label, palette[(number - 1) % palette.length], centroid ? JSON.stringify(Array.from(centroid)) : null, centroid ? 1 : 0);
    return this.getSpeaker(id);
  }

  createCandidateSpeaker(meetingId, centroid = null) {
    const id = randomUUID();
    const count = this.listSpeakers(meetingId).length;
    const palette = ["green", "violet", "amber", "blue", "rose", "teal"];
    this.db.prepare(`
      INSERT INTO speakers (id, meeting_id, label, display_name, color, centroid_json, sample_count)
      VALUES (?, ?, ?, '待编号发言人', ?, ?, ?)
    `).run(
      id,
      meetingId,
      `__candidate__${id}`,
      palette[count % palette.length],
      centroid ? JSON.stringify(Array.from(centroid)) : null,
      centroid ? 1 : 0,
    );
    return this.getSpeaker(id);
  }

  reconcileSpeakers(meetingId, orderedSpeakerIds) {
    const activeIds = [...new Set(orderedSpeakerIds.filter(Boolean))];
    const palette = ["green", "violet", "amber", "blue", "rose", "teal"];
    this.db.exec("BEGIN");
    try {
      const existing = this.db.prepare("SELECT id FROM speakers WHERE meeting_id = ?").all(meetingId);
      for (const speaker of existing) {
        this.db.prepare("UPDATE speakers SET label = ? WHERE id = ?").run(`__relabel__${speaker.id}`, speaker.id);
      }
      for (const speaker of existing) {
        if (!activeIds.includes(speaker.id)) this.db.prepare("DELETE FROM speakers WHERE id = ?").run(speaker.id);
      }
      activeIds.forEach((speakerId, index) => {
        const label = `发言人${index + 1}`;
        this.db.prepare(`
          UPDATE speakers
          SET label = ?,
              display_name = CASE WHEN manually_named = 0 THEN ? ELSE display_name END,
              color = ?
          WHERE id = ?
        `).run(label, label, palette[index % palette.length], speakerId);
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.listSpeakers(meetingId);
  }

  getSpeaker(id) {
    const row = this.db.prepare("SELECT * FROM speakers WHERE id = ?").get(id);
    return row ? this.hydrateSpeaker(row) : null;
  }

  listSpeakers(meetingId) {
    return this.db.prepare("SELECT * FROM speakers WHERE meeting_id = ? ORDER BY label").all(meetingId)
      .map((row) => this.hydrateSpeaker(row));
  }

  hydrateSpeaker(row) {
    return {
      id: row.id,
      meetingId: row.meeting_id,
      label: row.label,
      displayName: row.display_name,
      color: row.color,
      centroid: row.centroid_json ? JSON.parse(row.centroid_json) : null,
      sampleCount: row.sample_count,
      manuallyNamed: Boolean(row.manually_named),
    };
  }

  updateSpeakerCentroid(id, centroid, sampleCount) {
    this.db.prepare("UPDATE speakers SET centroid_json = ?, sample_count = ? WHERE id = ?")
      .run(JSON.stringify(Array.from(centroid)), sampleCount, id);
  }

  renameSpeaker(id, displayName) {
    const clean = String(displayName || "").trim().slice(0, 40);
    if (!clean) throw new Error("发言人姓名不能为空");
    this.db.prepare("UPDATE speakers SET display_name = ?, manually_named = 1 WHERE id = ?").run(clean, id);
    return this.getSpeaker(id);
  }

  createJob(meetingId, kind) {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO jobs (id, meeting_id, kind, status, progress, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', 0, ?, ?)
    `).run(id, meetingId, kind, now, now);
    return this.getJob(id);
  }

  getJob(id) {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
    return row ? this.hydrateJob(row) : null;
  }

  listJobs(meetingId) {
    return this.db.prepare("SELECT * FROM jobs WHERE meeting_id = ? ORDER BY created_at").all(meetingId)
      .map((row) => this.hydrateJob(row));
  }

  updateJob(id, patch) {
    const status = patch.status ?? this.getJob(id)?.status;
    const progress = patch.progress ?? this.getJob(id)?.progress ?? 0;
    const error = patch.error ?? null;
    this.db.prepare("UPDATE jobs SET status = ?, progress = ?, error = ?, updated_at = ? WHERE id = ?")
      .run(status, progress, error, new Date().toISOString(), id);
    return this.getJob(id);
  }

  hydrateJob(row) {
    return {
      id: row.id,
      meetingId: row.meeting_id,
      kind: row.kind,
      status: row.status,
      progress: row.progress,
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  deleteMeeting(id) {
    this.db.prepare("DELETE FROM meetings WHERE id = ?").run(id);
  }

  close() {
    this.db.close();
  }
}
