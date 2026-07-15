#!/system/bin/sh
# GPS Screen Control v4.0 - Enhanced Service Script
# For APatch/KernelSU on Android 10+
# Optimized for performance, battery efficiency, and reliability

MODULE_DIR="/data/adb/modules/gps_screen_control"
WHITELIST_FILE="${MODULE_DIR}/whitelist.txt"
LOG_FILE="/data/adb/gps_control.log"
LOG_MAX_SIZE=102400  # 100KB max log size
CHECK_INTERVAL=2    # Check every 2 seconds (reduced from 1.5s for battery)

# Initialize logging
init_logging() {
    if [ ! -f "${LOG_FILE}" ]; then
        touch "${LOG_FILE}" 2>/dev/null || return 1
    fi
    
    # Rotate log if too large
    local size=$(stat -f%z "${LOG_FILE}" 2>/dev/null || stat -c%s "${LOG_FILE}" 2>/dev/null || echo 0)
    if [ "${size}" -gt "${LOG_MAX_SIZE}" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] --- LOG ROTATED ---" > "${LOG_FILE}"
    fi
}

log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "${LOG_FILE}" 2>/dev/null
}

init_logging
log_message "==== GPS Control Service v4.0 Started ===="

# Get screen state (optimized)
get_screen_state() {
    local state=$(dumpsys display 2>/dev/null | grep "mScreenState" | head -1)
    case "${state}" in
        *ON*) echo "on" ;;
        *) echo "off" ;;
    esac
}

# Get foreground app package (optimized regex)
get_foreground_app() {
    dumpsys window windows 2>/dev/null | grep "mCurrentFocus" | head -1 | \
        sed -E 's|.*([a-zA-Z0-9._-]+)/.*|\1|g' | grep -oE '^[a-zA-Z0-9._-]+' || echo ""
}

# Check if process is alive (optimized)
app_process_alive() {
    local pkg="$1"
    [ -z "${pkg}" ] && return 1
    
    # Try pidof first (faster)
    pidof "${pkg}" >/dev/null 2>&1 && return 0
    
    # Fallback to ps
    ps -A 2>/dev/null | grep -q "${pkg}" && return 0
    return 1
}

# Check if any whitelisted app is running
has_whitelisted_app_alive() {
    [ ! -f "${WHITELIST_FILE}" ] && return 1
    
    while IFS= read -r pkg; do
        # Skip empty lines and comments
        case "${pkg}" in
            ''|'#'*) continue ;;
            *) app_process_alive "${pkg}" && return 0 ;;
        esac
    done < "${WHITELIST_FILE}"
    
    return 1
}

# Check if app is whitelisted
is_app_whitelisted() {
    local pkg="$1"
    [ -z "${pkg}" ] && return 1
    [ ! -f "${WHITELIST_FILE}" ] && return 1
    grep -q "^${pkg}\$" "${WHITELIST_FILE}" 2>/dev/null
}

# Enable GPS
enable_gps() {
    cmd location set-location-enabled true 2>/dev/null
    log_message "GPS enabled"
}

# Disable GPS
disable_gps() {
    cmd location set-location-enabled false 2>/dev/null
    log_message "GPS disabled"
}

# Main control loop
log_message "Entering control loop"
last_state=""

while true; do
    SCREEN_STATE=$(get_screen_state)
    
    if [ "${SCREEN_STATE}" = "off" ]; then
        # Screen off: always disable GPS
        if [ "${last_state}" != "screen_off" ]; then
            disable_gps
            last_state="screen_off"
        fi
    else
        # Screen on: check apps
        FG_APP=$(get_foreground_app)
        
        if is_app_whitelisted "${FG_APP}"; then
            # Foreground app is whitelisted
            if [ "${last_state}" != "fg_whitelisted" ]; then
                enable_gps
                log_message "Foreground app whitelisted: ${FG_APP}"
                last_state="fg_whitelisted"
            fi
        elif has_whitelisted_app_alive; then
            # Background app is whitelisted
            if [ "${last_state}" != "bg_whitelisted" ]; then
                enable_gps
                log_message "Whitelisted app in background"
                last_state="bg_whitelisted"
            fi
        else
            # No whitelisted apps
            if [ "${last_state}" != "no_whitelist" ]; then
                disable_gps
                last_state="no_whitelist"
            fi
        fi
    fi
    
    sleep ${CHECK_INTERVAL}
done
