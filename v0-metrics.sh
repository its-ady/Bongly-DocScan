#!/bin/bash

# New env path outside the project tree; legacy CLEAN path as fallback for
# in-flight sandboxes created before the migration.
# TODO: remove legacy path after rollout
ENV_FILE="/vercel/share/.env.project"
LEGACY_CLEAN_ENV_FILE="/vercel/share/v0-project/.env.development.local"

find_env_file() {
  if [ -f "$ENV_FILE" ]; then
    echo "$ENV_FILE"
  elif [ -f "$LEGACY_CLEAN_ENV_FILE" ]; then
    echo "$LEGACY_CLEAN_ENV_FILE"
  fi
}

get_callback_url() {
  local env_file
  env_file=$(find_env_file)
  if [ -z "$env_file" ]; then
    return 1
  fi
  local url
  url=$(grep "^V0_CODE_SERVER_CALLBACK_URL=" "$env_file" | head -1)
  if [ -z "$url" ]; then
    return 1
  fi
  url="${url#V0_CODE_SERVER_CALLBACK_URL=}"
  url="${url#\"}"
  url="${url%\"}"
  url="${url#\'}"
  url="${url%\'}"
  echo "$url"
}

get_deployment_target() {
  local env_file
  env_file=$(find_env_file)
  if [ -z "$env_file" ]; then
    return 0
  fi
  local target
  target=$(grep "^V0_CALLBACK_DEPLOYMENT_TARGET=" "$env_file" | head -1)
  if [ -z "$target" ]; then
    return 0
  fi
  target="${target#V0_CALLBACK_DEPLOYMENT_TARGET=}"
  target="${target#\"}"
  target="${target%\"}"
  target="${target#\'}"
  target="${target%\'}"
  echo "$target"
}

get_callback_token() {
  local env_file
  env_file=$(find_env_file)
  if [ -z "$env_file" ]; then
    return 0
  fi
  local token
  token=$(grep "^V0_CODE_SERVER_CALLBACK_TOKEN=" "$env_file" | head -1)
  if [ -z "$token" ]; then
    return 0
  fi
  token="${token#V0_CODE_SERVER_CALLBACK_TOKEN=}"
  token="${token#\"}"
  token="${token%\"}"
  token="${token#\'}"
  token="${token%\'}"
  echo "$token"
}

collect_and_send() {
  local callback_url
  callback_url=$(get_callback_url)
  if [ -z "$callback_url" ]; then
    return 0
  fi

  local deployment_target
  deployment_target=$(get_deployment_target)

  local callback_token
  callback_token=$(get_callback_token)

  # --- Memory from /proc/meminfo ---
  local mem_total=0 mem_available=0
  while IFS=": " read -r key value _unit; do
    case "$key" in
      MemTotal) mem_total=$value ;;
      MemAvailable) mem_available=$value ;;
    esac
  done < /proc/meminfo
  local mem_total_mb=$(( mem_total / 1024 ))
  local mem_available_mb=$(( mem_available / 1024 ))
  local mem_used_mb=$(( (mem_total - mem_available) / 1024 ))
  local mem_used_percent=0
  if [ "$mem_total" -gt 0 ]; then
    mem_used_percent=$(( (mem_total - mem_available) * 100 / mem_total ))
  fi

  # --- Load averages from /proc/loadavg ---
  local load_1m load_5m load_15m _rest
  read -r load_1m load_5m load_15m _rest < /proc/loadavg

  # --- CPU usage from /proc/stat (two samples 100ms apart) ---
  local cpu1 cpu2
  cpu1=$(head -1 /proc/stat)
  sleep 0.1
  cpu2=$(head -1 /proc/stat)

  local cpu_usage_percent
  cpu_usage_percent=$(awk -v c1="$cpu1" -v c2="$cpu2" "BEGIN {
    split(c1, a, \" \")
    split(c2, b, \" \")
    idle1 = a[5] + a[6]; idle2 = b[5] + b[6]
    total1 = 0; total2 = 0
    for (i = 2; i <= 9; i++) { total1 += a[i]; total2 += b[i] }
    td = total2 - total1; id = idle2 - idle1
    if (td > 0) printf \"%.1f\", (td - id) * 100.0 / td
    else printf \"0.0\"
  }")

  # --- Disk usage ---
  local disk_total_mb=0 disk_used_mb=0 disk_used_percent=0
  eval "$(df -BM / | awk "NR==2 {
    gsub(\"M\", \"\", \$2); gsub(\"M\", \"\", \$3); gsub(\"%\", \"\", \$5)
    printf \"disk_total_mb=%s disk_used_mb=%s disk_used_percent=%s\", \$2, \$3, \$5
  }")"

  # --- Build JSON payload ---
  local json
  json=$(cat <<JSONEOF
{"type":"metrics_report","metrics":{"memTotalMB":$mem_total_mb,"memAvailableMB":$mem_available_mb,"memUsedMB":$mem_used_mb,"memUsedPercent":$mem_used_percent,"loadAvg1m":$load_1m,"loadAvg5m":$load_5m,"loadAvg15m":$load_15m,"diskTotalMB":$disk_total_mb,"diskUsedMB":$disk_used_mb,"diskUsedPercent":$disk_used_percent,"cpuUsagePercent":$cpu_usage_percent}}
JSONEOF
)

  # --- Send to callback ---
  local -a curl_headers=(-H "Content-Type: application/json")
  if [ -n "$deployment_target" ]; then
    curl_headers+=(-H "x-v0-callback-target: $deployment_target")
  fi
  if [ -n "$callback_token" ]; then
    curl_headers+=(-H "x-v0-callback-token: $callback_token")
  fi

  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" -m 10 -X POST \
    "${curl_headers[@]}" \
    -d "$json" \
    "$callback_url" 2>/dev/null) || true
  if [ "$http_code" != "200" ]; then
    echo "[v0-metrics] Error: HTTP $http_code sending metrics"
  fi
}

# Main loop
while true; do
  collect_and_send || true
  sleep 60
done
