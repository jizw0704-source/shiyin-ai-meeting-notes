#!/usr/bin/env bash

set -euo pipefail

release_directory="${1:-release}"
expected_version="${2:-0.5.1}"
release_root="$(cd "$release_directory" && pwd)"
dmg_path="$(find "$release_root" -maxdepth 1 -type f -name "*-${expected_version}-arm64.dmg" -print -quit)"

if [[ -z "$dmg_path" ]]; then
  echo "没有找到 macOS DMG 安装包" >&2
  exit 1
fi

temporary_root="$(mktemp -d "${RUNNER_TEMP:-/tmp}/shiyin-macos-smoke.XXXXXX")"
mount_root="$temporary_root/mount"
install_root="$temporary_root/Applications"
installed_app="$install_root/拾音 AI.app"
smoke_home="$temporary_root/home"
user_data_root="$smoke_home/Library/Application Support/拾音 AI"
marker_path="$user_data_root/data/ci-upgrade-preserve.txt"
backend_port="18788"
web_port="13002"
app_pid=""
mounted="false"

stop_app() {
  if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  app_pid=""
  sleep 2
}

cleanup() {
  local status=$?
  stop_app
  if [[ "$mounted" == "true" ]]; then
    hdiutil detach "$mount_root" -quiet || true
  fi
  if [[ "$status" -eq 0 ]]; then
    rm -rf -- "$temporary_root"
  else
    echo "macOS 冒烟测试失败，诊断文件保留在：$temporary_root" >&2
    if [[ -f "$temporary_root/app.log" ]]; then
      tail -n 120 "$temporary_root/app.log" >&2 || true
    fi
  fi
  trap - EXIT
  exit "$status"
}
trap cleanup EXIT

install_from_dmg() {
  mkdir -p "$mount_root" "$install_root"
  hdiutil attach "$dmg_path" -mountpoint "$mount_root" -nobrowse -readonly -quiet
  mounted="true"
  if [[ ! -d "$mount_root/拾音 AI.app" ]]; then
    echo "DMG 中没有找到拾音 AI.app" >&2
    exit 1
  fi
  ditto "$mount_root/拾音 AI.app" "$installed_app"
  hdiutil detach "$mount_root" -quiet
  mounted="false"
}

start_and_verify() {
  local version executable health_file app_origin app_html
  version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$installed_app/Contents/Info.plist")"
  if [[ "$version" != "$expected_version" ]]; then
    echo "安装版本不符：期望 ${expected_version}，实际 ${version}" >&2
    exit 1
  fi

  executable="$installed_app/Contents/MacOS/拾音 AI"
  HOME="$smoke_home" \
    ASR_PROXY_PORT="$backend_port" \
    SHIYIN_WEB_PORT="$web_port" \
    SHIYIN_ALLOW_MULTIPLE_INSTANCES="1" \
    SHIYIN_USER_DATA_ROOT="$user_data_root" \
    "$executable" --disable-gpu >"$temporary_root/app.log" 2>&1 &
  app_pid=$!
  health_file="$temporary_root/health.json"

  for _ in $(seq 1 120); do
    if curl --fail --silent --show-error --max-time 2 \
      "http://127.0.0.1:$backend_port/health" >"$health_file" 2>/dev/null; then
      break
    fi
    sleep 1
  done

  node -e '
    const fs = require("fs");
    const health = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (!health.ok) throw new Error("本地后台状态异常");
    if (health.service !== "shiyin-ai-backend") throw new Error("后台身份校验失败");
    if (health.asrMode !== "local" || !health.localAsrAvailable) throw new Error("本地转写模型不可用");
    if (!health.punctuationModelAvailable) throw new Error("本地标点模型不可用");
    if (!health.speakerModelAvailable) throw new Error("发言人模型不可用");
    if (!health.overlapSeparationModelAvailable) throw new Error("重叠语音拆解模型不可用");
    if (!health.appOrigin) throw new Error("缺少应用地址");
    process.stdout.write(health.appOrigin);
  ' "$health_file" >"$temporary_root/app-origin.txt"

  app_origin="$(cat "$temporary_root/app-origin.txt")"
  app_html="$temporary_root/app.html"
  curl --fail --silent --show-error --max-time 10 "$app_origin" >"$app_html"
  grep -q '<title>拾音 AI' "$app_html"
}

install_from_dmg
start_and_verify
stop_app

mkdir -p "$(dirname "$marker_path")"
printf '%s\n' 'preserve-across-upgrade' >"$marker_path"

install_from_dmg
if [[ ! -f "$marker_path" ]] || ! grep -q 'preserve-across-upgrade' "$marker_path"; then
  echo "覆盖安装删除或修改了已有用户数据" >&2
  exit 1
fi
start_and_verify
stop_app

mv "$installed_app" "$temporary_root/拾音 AI.app.removed"
if [[ ! -f "$marker_path" ]]; then
  echo "移除应用后用户会议数据丢失" >&2
  exit 1
fi

node -e '
  const fs = require("fs");
  const result = {
    ok: true,
    version: process.argv[1],
    installer: process.argv[2],
    architecture: process.arch,
    localAsrAvailable: true,
    punctuationModelAvailable: true,
    speakerModelAvailable: true,
    overlapSeparationModelAvailable: true,
    dataPreservedAcrossUpgrade: true,
    dataPreservedAfterAppRemoval: true,
  };
  fs.writeFileSync(process.argv[3], `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
' "$expected_version" "$(basename "$dmg_path")" "$release_root/macos-smoke-result.json"
