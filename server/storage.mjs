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
import { normalizeMaxSpeakers } from "./speaker-settings.mjs";

const speakerPalette = [
  "green", "violet", "amber", "blue", "rose", "teal", "orange", "indigo", "cyan", "lime",
  "pink", "brown", "red", "purple", "aqua", "gold", "navy", "olive", "coral", "slate",
];

function normalizeVoiceVector(vector) {
  if (!vector || !Array.from(vector).length) return null;
  const values = Array.from(vector, Number);
  if (!values.every(Number.isFinite)) return null;
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) return null;
  return values.map((value) => value / magnitude);
}

function voiceSimilarity(left, right) {
  if (!left || !right || left.length !== right.length) return -1;
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function blendVoiceVectors(current, incoming, incomingWeight) {
  return normalizeVoiceVector(current.map((value, index) =>
    value * (1 - incomingWeight) + incoming[index] * incomingWeight));
}

export class MeetingStorage {
  constructor(dataRoot = path.resolve("data")) {
    this.dataRoot = dataRoot;
    this.profileImportAliases = new Map();
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
        summary_stale INTEGER NOT NULL DEFAULT 0,
        active_transcript_version_id TEXT,
        max_speakers INTEGER NOT NULL DEFAULT 6
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
        profile_id TEXT,
        auto_matched INTEGER NOT NULL DEFAULT 0,
        UNIQUE(meeting_id, label)
      );
      CREATE TABLE IF NOT EXISTS speaker_profiles (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        centroid_json TEXT NOT NULL,
        sample_count INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
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
      CREATE TABLE IF NOT EXISTS transcript_versions (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        version_no INTEGER NOT NULL,
        label TEXT NOT NULL,
        engine TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        segment_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE(meeting_id, version_no)
      );
      CREATE INDEX IF NOT EXISTS idx_segments_meeting_seq ON segments(meeting_id, seq);
      CREATE INDEX IF NOT EXISTS idx_speakers_meeting ON speakers(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_speaker_profiles_name ON speaker_profiles(display_name);
      CREATE INDEX IF NOT EXISTS idx_jobs_meeting ON jobs(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_transcript_edits_meeting ON transcript_edits(meeting_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_transcript_versions_meeting ON transcript_versions(meeting_id, version_no);
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
    if (!meetingColumns.has("active_transcript_version_id")) {
      this.db.exec("ALTER TABLE meetings ADD COLUMN active_transcript_version_id TEXT");
    }
    if (!meetingColumns.has("max_speakers")) {
      this.db.exec("ALTER TABLE meetings ADD COLUMN max_speakers INTEGER NOT NULL DEFAULT 6");
    }
    const segmentColumns = new Set(
      this.db.prepare("PRAGMA table_info(segments)").all().map((column) => column.name),
    );
    if (!segmentColumns.has("edited_text")) {
      this.db.exec("ALTER TABLE segments ADD COLUMN edited_text TEXT");
    }
    const speakerColumns = new Set(
      this.db.prepare("PRAGMA table_info(speakers)").all().map((column) => column.name),
    );
    if (!speakerColumns.has("profile_id")) {
      this.db.exec("ALTER TABLE speakers ADD COLUMN profile_id TEXT");
    }
    if (!speakerColumns.has("auto_matched")) {
      this.db.exec("ALTER TABLE speakers ADD COLUMN auto_matched INTEGER NOT NULL DEFAULT 0");
    }
    this.bootstrapSpeakerProfiles();
  }

  createMeeting(title = "未命名会议", options = {}) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const summaryTemplate = normalizeSummaryTemplateId(options.summaryTemplate);
    const reportStyle = normalizeReportStyle(options.reportStyle);
    const maxSpeakers = normalizeMaxSpeakers(options.maxSpeakers);
    const templateVersion = Number.isInteger(options.templateVersion)
      ? options.templateVersion
      : SUMMARY_TEMPLATE_VERSION;
    const directory = path.join(this.dataRoot, "meetings", id);
    mkdirSync(directory, { recursive: true });
    this.db.prepare(`
      INSERT INTO meetings
      (id, title, status, created_at, started_at, summary_template, template_version, report_style, max_speakers)
      VALUES (?, ?, 'recording', ?, ?, ?, ?, ?, ?)
    `).run(id, title, now, now, summaryTemplate, templateVersion, reportStyle, maxSpeakers);
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
      activeTranscriptVersionId: meeting.active_transcript_version_id || null,
      maxSpeakers: normalizeMaxSpeakers(meeting.max_speakers),
    };
    if (!includeDetails) return value;
    value.speakers = this.listSpeakers(meeting.id);
    value.segments = this.listSegments(meeting.id).map((segment) => ({
      ...segment,
      cleanedText: value.fillerFilterEnabled ? cleanTranscriptText(segment.text) : segment.text,
    }));
    value.jobs = this.listJobs(meeting.id);
    value.transcriptVersions = this.listTranscriptVersions(meeting.id);
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
      activeTranscriptVersionId: "active_transcript_version_id",
      maxSpeakers: "max_speakers",
    };
    const normalizedPatch = {
      ...patch,
      ...(Object.hasOwn(patch, "maxSpeakers") ? { maxSpeakers: normalizeMaxSpeakers(patch.maxSpeakers) } : {}),
    };
    const entries = Object.entries(normalizedPatch).filter(([key]) => map[key]);
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
    const originalText = String(segment.originalText ?? segment.text ?? "");
    const editedText = Object.hasOwn(segment, "editedText")
      ? segment.editedText
      : (segment.originalText !== undefined && segment.text !== originalText ? segment.text : null);
    this.db.prepare(`
      INSERT INTO segments
      (id, meeting_id, seq, start_ms, end_ms, pause_after_ms, text, speaker_id, source, confidence, words_json, edited_text, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      meetingId,
      segment.seq,
      segment.startMs,
      segment.endMs ?? null,
      segment.pauseAfterMs ?? null,
      originalText,
      segment.speakerId ?? null,
      segment.source || "realtime",
      segment.confidence ?? null,
      segment.words ? JSON.stringify(segment.words) : null,
      editedText,
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

  transcriptSnapshot(meetingId) {
    const meeting = this.getMeeting(meetingId);
    if (!meeting) throw new Error("会议不存在");
    return {
      speakers: meeting.speakers,
      segments: meeting.segments,
      summary: meeting.summary,
      liveSummary: meeting.liveSummary,
      fillerFilterEnabled: meeting.fillerFilterEnabled,
      summaryStale: meeting.summaryStale,
    };
  }

  createTranscriptVersion(meetingId, options = {}) {
    const snapshot = options.snapshot || this.transcriptSnapshot(meetingId);
    const versionNo = Number(this.db.prepare(`
      SELECT COALESCE(MAX(version_no), 0) + 1 AS value
      FROM transcript_versions WHERE meeting_id = ?
    `).get(meetingId)?.value || 1);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO transcript_versions
      (id, meeting_id, version_no, label, engine, snapshot_json, segment_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      meetingId,
      versionNo,
      String(options.label || `转写版本 ${versionNo}`).slice(0, 80),
      String(options.engine || "local").slice(0, 80),
      JSON.stringify(snapshot),
      snapshot.segments?.length || 0,
      createdAt,
    );
    if (options.active) {
      this.db.prepare("UPDATE meetings SET active_transcript_version_id = ? WHERE id = ?").run(id, meetingId);
    }
    return this.getTranscriptVersion(id, true);
  }

  getTranscriptVersion(id, includeSnapshot = false) {
    const row = this.db.prepare("SELECT * FROM transcript_versions WHERE id = ?").get(id);
    if (!row) return null;
    return this.hydrateTranscriptVersion(row, includeSnapshot);
  }

  listTranscriptVersions(meetingId, includeSnapshot = false) {
    return this.db.prepare(`
      SELECT * FROM transcript_versions WHERE meeting_id = ? ORDER BY version_no DESC
    `).all(meetingId).map((row) => this.hydrateTranscriptVersion(row, includeSnapshot));
  }

  hydrateTranscriptVersion(row, includeSnapshot = false) {
    const value = {
      id: row.id,
      meetingId: row.meeting_id,
      versionNo: row.version_no,
      label: row.label,
      engine: row.engine,
      segmentCount: row.segment_count,
      createdAt: row.created_at,
    };
    if (includeSnapshot) value.snapshot = JSON.parse(row.snapshot_json);
    return value;
  }

  replaceRetranscribedSegments(meetingId, segments) {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM segments WHERE meeting_id = ?").run(meetingId);
      this.db.prepare("DELETE FROM transcript_edits WHERE meeting_id = ?").run(meetingId);
      this.db.prepare("DELETE FROM speakers WHERE meeting_id = ?").run(meetingId);
      for (const segment of segments) this.addSegment(meetingId, { ...segment, source: "local-retranscribed" });
      this.db.prepare(`
        UPDATE meetings
        SET live_summary_json = NULL, summary_stale = 1, active_transcript_version_id = NULL
        WHERE id = ?
      `).run(meetingId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getMeeting(meetingId);
  }

  restoreTranscriptVersion(meetingId, versionId) {
    const version = this.getTranscriptVersion(versionId, true);
    if (!version || version.meetingId !== meetingId) throw new Error("转写版本不存在");
    const meeting = this.getMeeting(meetingId);
    if (!meeting) throw new Error("会议不存在");
    if (meeting.activeTranscriptVersionId === versionId) return meeting;
    this.createTranscriptVersion(meetingId, { label: "切换前自动保存", engine: "local-snapshot" });
    const snapshot = version.snapshot;
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM segments WHERE meeting_id = ?").run(meetingId);
      this.db.prepare("DELETE FROM transcript_edits WHERE meeting_id = ?").run(meetingId);
      this.db.prepare("DELETE FROM speakers WHERE meeting_id = ?").run(meetingId);
      for (const speaker of snapshot.speakers || []) {
        this.db.prepare(`
          INSERT INTO speakers
          (id, meeting_id, label, display_name, color, centroid_json, sample_count, manually_named, profile_id, auto_matched)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          speaker.id,
          meetingId,
          speaker.label,
          speaker.displayName,
          speaker.color,
          speaker.centroid ? JSON.stringify(speaker.centroid) : null,
          speaker.sampleCount || 0,
          speaker.manuallyNamed ? 1 : 0,
          speaker.profileId || null,
          speaker.autoMatched ? 1 : 0,
        );
      }
      for (const segment of snapshot.segments || []) {
        this.db.prepare(`
          INSERT INTO segments
          (id, meeting_id, seq, start_ms, end_ms, pause_after_ms, text, speaker_id, source, confidence, words_json, edited_text, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          segment.id || randomUUID(),
          meetingId,
          segment.seq,
          segment.startMs,
          segment.endMs ?? null,
          segment.pauseAfterMs ?? null,
          segment.originalText ?? segment.text,
          segment.speakerId ?? null,
          segment.source || "local-retranscribed",
          segment.confidence ?? null,
          JSON.stringify(segment.words || []),
          segment.editedText ?? null,
          segment.createdAt || new Date().toISOString(),
        );
      }
      this.db.prepare(`
        UPDATE meetings
        SET summary_json = ?, live_summary_json = ?, filler_filter_enabled = ?, summary_stale = ?,
            active_transcript_version_id = ?, status = 'completed', error = NULL
        WHERE id = ?
      `).run(
        snapshot.summary ? JSON.stringify(snapshot.summary) : null,
        snapshot.liveSummary ? JSON.stringify(snapshot.liveSummary) : null,
        snapshot.fillerFilterEnabled ? 1 : 0,
        snapshot.summaryStale ? 1 : 0,
        versionId,
        meetingId,
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getMeeting(meetingId);
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

  ensureSpeaker(meetingId, label, centroid = null, options = {}) {
    const existing = this.db.prepare("SELECT * FROM speakers WHERE meeting_id = ? AND label = ?").get(meetingId, label);
    if (existing) return this.hydrateSpeaker(existing);
    const number = Number(label.match(/\d+/)?.[0] || 1);
    const id = randomUUID();
    const profile = options.profile || null;
    this.db.prepare(`
      INSERT INTO speakers
      (id, meeting_id, label, display_name, color, centroid_json, sample_count, profile_id, auto_matched)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      meetingId,
      label,
      profile?.displayName || label,
      speakerPalette[(number - 1) % speakerPalette.length],
      centroid ? JSON.stringify(Array.from(centroid)) : null,
      centroid ? 1 : 0,
      profile?.id || null,
      profile ? 1 : 0,
    );
    return this.getSpeaker(id);
  }

  createCandidateSpeaker(meetingId, centroid = null, options = {}) {
    const id = randomUUID();
    const count = this.listSpeakers(meetingId).length;
    const profile = options.profile || null;
    this.db.prepare(`
      INSERT INTO speakers
      (id, meeting_id, label, display_name, color, centroid_json, sample_count, profile_id, auto_matched)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      meetingId,
      `__candidate__${id}`,
      profile?.displayName || "待编号发言人",
      speakerPalette[count % speakerPalette.length],
      centroid ? JSON.stringify(Array.from(centroid)) : null,
      centroid ? 1 : 0,
      profile?.id || null,
      profile ? 1 : 0,
    );
    return this.getSpeaker(id);
  }

  reconcileSpeakers(meetingId, orderedSpeakerIds) {
    const activeIds = [...new Set(orderedSpeakerIds.filter(Boolean))];
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
              display_name = CASE WHEN manually_named = 0 AND auto_matched = 0 THEN ? ELSE display_name END,
              color = ?
          WHERE id = ?
        `).run(label, label, speakerPalette[index % speakerPalette.length], speakerId);
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
      profileId: row.profile_id || null,
      autoMatched: Boolean(row.auto_matched),
    };
  }

  updateSpeakerCentroid(id, centroid, sampleCount) {
    this.db.prepare("UPDATE speakers SET centroid_json = ?, sample_count = ? WHERE id = ?")
      .run(JSON.stringify(Array.from(centroid)), sampleCount, id);
    const speaker = this.getSpeaker(id);
    if (speaker?.manuallyNamed && !speaker.profileId) this.learnSpeakerProfile(id);
  }

  renameSpeaker(id, displayName) {
    const clean = String(displayName || "").trim().slice(0, 40);
    if (!clean) throw new Error("发言人姓名不能为空");
    const existing = this.getSpeaker(id);
    if (!existing) throw new Error("发言人不存在");
    this.db.prepare(`
      UPDATE speakers
      SET display_name = ?, manually_named = 1, auto_matched = 0,
          profile_id = CASE WHEN display_name = ? THEN profile_id ELSE NULL END
      WHERE id = ?
    `).run(clean, clean, id);
    this.learnSpeakerProfile(id);
    return this.getSpeaker(id);
  }

  listSpeakerProfiles() {
    return this.db.prepare("SELECT * FROM speaker_profiles ORDER BY updated_at DESC").all()
      .map((row) => this.hydrateSpeakerProfile(row));
  }

  getSpeakerProfile(id) {
    const row = this.db.prepare("SELECT * FROM speaker_profiles WHERE id = ?").get(id);
    return row ? this.hydrateSpeakerProfile(row) : null;
  }

  hydrateSpeakerProfile(row) {
    return {
      id: row.id,
      displayName: row.display_name,
      centroid: JSON.parse(row.centroid_json),
      sampleCount: row.sample_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  matchSpeakerProfile(centroid, options = {}) {
    const vector = normalizeVoiceVector(centroid);
    if (!vector) return null;
    const excluded = new Set(options.excludeProfileIds || []);
    const matches = this.listSpeakerProfiles()
      .filter((profile) => !excluded.has(profile.id))
      .map((profile) => ({ ...profile, score: voiceSimilarity(vector, profile.centroid) }))
      .filter((profile) => profile.score >= -1)
      .sort((left, right) => right.score - left.score);
    const best = matches[0];
    if (!best || best.score < (options.threshold ?? 0.78)) return null;
    const runnerUp = matches[1];
    if (runnerUp && best.score - runnerUp.score < (options.ambiguityMargin ?? 0.04)) return null;
    return best;
  }

  applySpeakerProfile(speakerId, profile) {
    if (!profile) return this.getSpeaker(speakerId);
    this.db.prepare(`
      UPDATE speakers
      SET display_name = ?, profile_id = ?, auto_matched = 1
      WHERE id = ? AND manually_named = 0
    `).run(profile.displayName, profile.id, speakerId);
    return this.getSpeaker(speakerId);
  }

  clearAutomaticSpeakerMatch(speakerId) {
    this.db.prepare(`
      UPDATE speakers
      SET profile_id = NULL, auto_matched = 0,
          display_name = CASE WHEN manually_named = 0 THEN label ELSE display_name END
      WHERE id = ?
    `).run(speakerId);
    return this.getSpeaker(speakerId);
  }

  learnSpeakerProfile(speakerId, options = {}) {
    const speaker = this.getSpeaker(speakerId);
    const vector = normalizeVoiceVector(speaker?.centroid);
    if (!speaker?.manuallyNamed || !vector) return speaker;
    const sameName = this.db.prepare(`
      SELECT * FROM speaker_profiles WHERE display_name = ? COLLATE NOCASE
    `).all(speaker.displayName).map((row) => this.hydrateSpeakerProfile(row));
    const linked = sameName.find((profile) => profile.id === speaker.profileId);
    const nearest = sameName
      .map((profile) => ({ profile, score: voiceSimilarity(vector, profile.centroid) }))
      .sort((left, right) => right.score - left.score)[0];
    const matched = linked || (nearest?.score >= 0.78 ? nearest.profile : null);
    const now = new Date().toISOString();
    let profile;
    if (matched) {
      const refining = matched.id === speaker.profileId || options.refine;
      const count = refining ? matched.sampleCount : matched.sampleCount + 1;
      const weight = refining ? 0.2 : Math.min(0.35, 1 / count);
      const blended = blendVoiceVectors(matched.centroid, vector, weight) || vector;
      this.db.prepare(`
        UPDATE speaker_profiles
        SET centroid_json = ?, sample_count = ?, updated_at = ? WHERE id = ?
      `).run(JSON.stringify(blended), count, now, matched.id);
      profile = this.getSpeakerProfile(matched.id);
    } else {
      const id = randomUUID();
      this.db.prepare(`
        INSERT INTO speaker_profiles
        (id, display_name, centroid_json, sample_count, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)
      `).run(id, speaker.displayName, JSON.stringify(vector), now, now);
      profile = this.getSpeakerProfile(id);
    }
    this.db.prepare("UPDATE speakers SET profile_id = ? WHERE id = ?").run(profile.id, speakerId);
    return this.getSpeaker(speakerId);
  }

  refineMeetingSpeakerProfiles(meetingId) {
    for (const speaker of this.listSpeakers(meetingId)) {
      if (speaker.manuallyNamed && speaker.centroid) this.learnSpeakerProfile(speaker.id, { refine: true });
    }
  }

  bootstrapSpeakerProfiles() {
    const rows = this.db.prepare(`
      SELECT id FROM speakers
      WHERE manually_named = 1 AND centroid_json IS NOT NULL AND profile_id IS NULL
    `).all();
    for (const row of rows) this.learnSpeakerProfile(row.id);
  }

  exportSpeakerProfiles() {
    return this.listSpeakerProfiles();
  }

  importSpeakerProfiles(profiles = []) {
    for (const incoming of profiles) {
      const vector = normalizeVoiceVector(incoming?.centroid);
      const displayName = String(incoming?.displayName || "").trim().slice(0, 40);
      if (!vector || !displayName) continue;
      const existingById = incoming.id ? this.getSpeakerProfile(incoming.id) : null;
      const sameName = this.db.prepare(`
        SELECT * FROM speaker_profiles WHERE display_name = ? COLLATE NOCASE
      `).all(displayName).map((row) => this.hydrateSpeakerProfile(row));
      const nearest = sameName
        .map((profile) => ({ profile, score: voiceSimilarity(vector, profile.centroid) }))
        .sort((left, right) => right.score - left.score)[0];
      const existing = existingById || (nearest?.score >= 0.78 ? nearest.profile : null);
      const now = new Date().toISOString();
      if (existing) {
        if (incoming.id) this.profileImportAliases.set(incoming.id, existing.id);
      } else {
        const requestedId = String(incoming.id || "");
        const id = requestedId && !this.getSpeakerProfile(requestedId) ? requestedId : randomUUID();
        this.db.prepare(`
          INSERT INTO speaker_profiles
          (id, display_name, centroid_json, sample_count, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          id,
          displayName,
          JSON.stringify(vector),
          Math.max(1, Number(incoming.sampleCount) || 1),
          incoming.createdAt || now,
          incoming.updatedAt || now,
        );
        if (incoming.id) this.profileImportAliases.set(incoming.id, id);
      }
    }
    return this.listSpeakerProfiles();
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

  exportMeetingSnapshot(meetingId) {
    const meeting = this.getMeeting(meetingId);
    if (!meeting) throw new Error("会议不存在");
    const transcriptEdits = this.db.prepare(`
      SELECT * FROM transcript_edits WHERE meeting_id = ? ORDER BY created_at
    `).all(meetingId).map((row) => ({
      id: row.id,
      findText: row.find_text,
      replacementText: row.replacement_text,
      changes: JSON.parse(row.changes_json),
      createdAt: row.created_at,
      undoneAt: row.undone_at,
    }));
    return {
      ...meeting,
      jobs: [],
      transcriptEdits,
      transcriptVersions: this.listTranscriptVersions(meetingId, true),
    };
  }

  importMeetingSnapshot(snapshot, options = {}) {
    const meetingId = String(snapshot?.id || "");
    if (!/^[A-Za-z0-9-]{1,80}$/.test(meetingId)) throw new Error("备份中的会议编号无效");
    if (this.getMeeting(meetingId)) return { imported: false, meeting: this.getMeeting(meetingId) };
    const now = new Date().toISOString();
    const audioPath = options.audioPath || null;
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`
        INSERT INTO meetings
        (id, title, status, created_at, started_at, ended_at, duration_ms, audio_path,
         summary_json, live_summary_json, error, summary_template, template_version,
         report_style, filler_filter_enabled, summary_stale, active_transcript_version_id, max_speakers)
        VALUES (?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        meetingId,
        String(snapshot.title || "已恢复会议").slice(0, 80),
        snapshot.createdAt || snapshot.startedAt || now,
        snapshot.startedAt || now,
        snapshot.endedAt || now,
        Math.max(0, Number(snapshot.durationMs) || 0),
        audioPath,
        snapshot.summary ? JSON.stringify(snapshot.summary) : null,
        snapshot.liveSummary ? JSON.stringify(snapshot.liveSummary) : null,
        normalizeSummaryTemplateId(snapshot.summaryTemplate),
        Number(snapshot.templateVersion || SUMMARY_TEMPLATE_VERSION),
        normalizeReportStyle(snapshot.reportStyle),
        snapshot.fillerFilterEnabled ? 1 : 0,
        snapshot.summaryStale ? 1 : 0,
        snapshot.activeTranscriptVersionId || null,
        normalizeMaxSpeakers(snapshot.maxSpeakers),
      );
      for (const speaker of snapshot.speakers || []) {
        const profileId = this.profileImportAliases.get(speaker.profileId) || speaker.profileId || null;
        this.db.prepare(`
          INSERT INTO speakers
          (id, meeting_id, label, display_name, color, centroid_json, sample_count, manually_named, profile_id, auto_matched)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          speaker.id || randomUUID(),
          meetingId,
          speaker.label,
          speaker.displayName,
          speaker.color || "blue",
          speaker.centroid ? JSON.stringify(speaker.centroid) : null,
          speaker.sampleCount || 0,
          speaker.manuallyNamed ? 1 : 0,
          profileId,
          speaker.autoMatched && profileId ? 1 : 0,
        );
      }
      for (const segment of snapshot.segments || []) {
        this.db.prepare(`
          INSERT INTO segments
          (id, meeting_id, seq, start_ms, end_ms, pause_after_ms, text, speaker_id, source, confidence, words_json, edited_text, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          segment.id || randomUUID(),
          meetingId,
          segment.seq,
          segment.startMs,
          segment.endMs ?? null,
          segment.pauseAfterMs ?? null,
          segment.originalText ?? segment.text,
          segment.speakerId ?? null,
          segment.source || "restored",
          segment.confidence ?? null,
          JSON.stringify(segment.words || []),
          segment.editedText ?? null,
          segment.createdAt || now,
        );
      }
      for (const edit of snapshot.transcriptEdits || []) {
        this.db.prepare(`
          INSERT INTO transcript_edits
          (id, meeting_id, find_text, replacement_text, changes_json, created_at, undone_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          edit.id || randomUUID(),
          meetingId,
          edit.findText,
          edit.replacementText,
          JSON.stringify(edit.changes || []),
          edit.createdAt || now,
          edit.undoneAt || null,
        );
      }
      for (const version of snapshot.transcriptVersions || []) {
        if (!version.snapshot) continue;
        this.db.prepare(`
          INSERT INTO transcript_versions
          (id, meeting_id, version_no, label, engine, snapshot_json, segment_count, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          version.id || randomUUID(),
          meetingId,
          version.versionNo,
          version.label,
          version.engine,
          JSON.stringify(version.snapshot),
          version.segmentCount || version.snapshot.segments?.length || 0,
          version.createdAt || now,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.bootstrapSpeakerProfiles();
    return { imported: true, meeting: this.getMeeting(meetingId) };
  }

  deleteMeeting(id) {
    this.db.prepare("DELETE FROM meetings WHERE id = ?").run(id);
  }

  close() {
    this.db.close();
  }
}
