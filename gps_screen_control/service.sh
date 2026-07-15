#!/system/bin/sh
# GPS Screen Control v3.1 - Core Service Script
# For APatch/KernelSU on OnePlus 8 with ColorOS 15/16
# Optimized for multi-process persistence and battery efficiency

MODULE_DIR="/data/adb/modules/gps_screen_control"
WHITELIST_FILE="${MODULE_DIR}/whitelist.txt"
LOG_FILE="/data/adb/gps_control.log"

# Ensure log file exists
touch "${LOG_FILE}"

log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "${LOG_FILE}"
}

log_message "GPS Control Service Started - v3.1"

# Function to get screen state (ColorOS 15/16 compatible)
get_screen_state() {
    # Check if screen is on via dumpsys display
    local state=$(dumpsys display | grep -i "mScreenState" | head -1)
    if echo "${state}" | grep -q "ON"; then
        echo "on"
    else
        echo "off"
    fi
}

# Function to get foreground app package name
get_foreground_app() {
    local fg=$(dumpsys window windows | grep -i "mCurrentFocus" | head -1)
    # Extract package name from focus window
    if echo "${fg}" | grep -q "Window{.*}"; then
        echo "${fg}" | sed 's/.*\([a-zA-Z0-9._]*\/[a-zA-Z0-9._]*\).*/\1/' | cut -d'/' -f1
    fi
}

# Function to enable GPS
enable_gps() {
    # Use settings to enable GPS
    su -c "settings put secure location_providers_allowed +gps" 2>/dev/null
    su -c "settings put secure location_mode 3" 2>/dev/null
    log_message "GPS enabled"
}

# Function to disable GPS
disable_gps() {
    # Use settings to disable GPS
    su -c "settings put secure location_providers_allowed -gps" 2>/dev/null
    su -c "settings put secure location_mode 0" 2>/dev/null
    log_message "GPS disabled"
}

# Function to check if app process is alive
app_process_alive() {
    local pkg="$1"
    if pidof "${pkg}" > /dev/null 2>&1; then
        return 0
    fi
    if ps -A 2>/dev/null | grep -q "${pkg}"; then
        return 0
    fi
    return 1
}

# Function to check if any whitelisted app is running in background
has_whitelisted_app_alive() {
    if [ ! -f "${WHITELIST_FILE}" ]; then
        return 1
    fi
    
    while IFS= read -r line; do
        # Skip empty lines
        if [ -z "${line}" ]; then
            continue
        fi
        # Skip comments
        if echo "${line}" | grep -q "^#"; then
            continue
        fi
        # Check if package is alive
        if app_process_alive "${line}"; then
            log_message "Whitelisted app alive in background: ${line}"
            return 0
        fi
    done < "${WHITELIST_FILE}"
    
    return 1
}

# Function to check if app is in whitelist
is_app_whitelisted() {
    local pkg="$1"
    if [ ! -f "${WHITELIST_FILE}" ]; then
        return 1
    fi
    grep -q "^${pkg}$" "${WHITELIST_FILE}" 2>/dev/null
}

# Main control loop
log_message "Entering main control loop"

while true; do
    SCREEN_STATE=$(get_screen_state)
    
    # If screen is OFF: Force disable GPS for maximum battery saving
    if [ "${SCREEN_STATE}" = "off" ]; then
        disable_gps
        sleep 2
        continue
    fi
    
    # Screen is ON: Check foreground app and background processes
    FG_APP=$(get_foreground_app)
    
    # Case A: Foreground app is whitelisted
    if is_app_whitelisted "${FG_APP}"; then
        log_message "Foreground app whitelisted: ${FG_APP} - Enabling GPS"
        enable_gps
    else
        # Case B: Foreground app is NOT whitelisted (e.g., home screen, other apps)
        # Check if any whitelisted app is still running in background
        if has_whitelisted_app_alive; then
            log_message "No whitelisted app in foreground, but whitelisted apps running in background - Keeping GPS ON"
            enable_gps
        else
            log_message "No whitelisted apps running anywhere - Disabling GPS"
            disable_gps
        fi
    fi
    
    # Check every 1.5 seconds for responsive control
    sleep 1.5
done
