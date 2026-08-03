import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";

export function parseByteRange(value, size) {
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  if (!value) return { start: 0, end: size - 1, partial: false };

  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(value).trim());
  if (!match || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return {
      start: Math.max(0, size - suffixLength),
      end: size - 1,
      partial: true,
    };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) {
    return null;
  }
  return {
    start,
    end: Math.min(requestedEnd, size - 1),
    partial: true,
  };
}

export function streamMeetingAudio(request, response, {
  meeting,
  dataRoot,
  appOrigin = "http://127.0.0.1:3000",
}) {
  const meetingsRoot = path.resolve(dataRoot, "meetings");
  const audioPath = meeting?.audioPath ? path.resolve(meeting.audioPath) : "";
  const allowedPrefix = `${meetingsRoot}${path.sep}`;

  if (!audioPath || !audioPath.startsWith(allowedPrefix) || !existsSync(audioPath)) {
    response.writeHead(404, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": appOrigin,
    });
    response.end(JSON.stringify({ error: "原始录音不存在" }));
    return;
  }

  const size = statSync(audioPath).size;
  const range = parseByteRange(request.headers.range, size);
  if (!range) {
    response.writeHead(416, {
      "Content-Range": `bytes */${size}`,
      "Access-Control-Allow-Origin": appOrigin,
    });
    response.end();
    return;
  }

  const headers = {
    "Content-Type": "audio/wav",
    "Content-Length": String(range.end - range.start + 1),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=0, must-revalidate",
    "Access-Control-Allow-Origin": appOrigin,
  };
  if (range.partial) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
  response.writeHead(range.partial ? 206 : 200, headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(audioPath, { start: range.start, end: range.end }).pipe(response);
}
