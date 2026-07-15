// GPS Screen Control v4.0 - JavaScript Interface
// Completely rewritten for reliability and performance

const CONFIG = {
    MODULE_DIR: '/data/adb/modules/gps_screen_control',
    WHITELIST_FILE: '/data/adb/modules/gps_screen_control/whitelist.txt',
    STATUS_UPDATE_INTERVAL: 5000,  // 5 seconds
    COMMAND_TIMEOUT: 8000,          // 8 seconds
    MAX_RETRIES: 2
};

let statusUpdateInterval = null;

/**
 * Execute shell command via KernelSU/APatch
 */
async function executeCommand(cmd, timeout = CONFIG.COMMAND_TIMEOUT) {
    return new Promise((resolve) => {
        let timeoutHandle = null;
        let finished = false;

        const done = (result) => {
            if (finished) return;
            finished = true;
            if (timeoutHandle) clearTimeout(timeoutHandle);
            resolve(result);
        };

        // Set timeout
        timeoutHandle = setTimeout(() => {
            done({ success: false, error: 'timeout', output: '' });
        }, timeout);

        try {
            if (window.ksu?.exec) {
                window.ksu.exec(cmd, (res) => {
                    done({
                        success: res?.success !== false && res?.code === 0,
                        output: res?.stdout || res || '',
                        error: res?.stderr || null
                    });
                });
            } else if (window.su?.exec) {
                window.su.exec(cmd, (res) => {
                    done({
                        success: true,
                        output: res || '',
                        error: null
                    });
                });
            } else {
                done({ success: false, error: 'no_interface', output: '' });
            }
        } catch (e) {
            done({ success: false, error: e.message, output: '' });
        }
    });
}

/**
 * Load installed applications
 */
async function loadApplications() {
    const loader = document.getElementById('loadingIndicator');
    const container = document.getElementById('appListContainer');

    loader.style.display = 'flex';
    container.style.display = 'none';
    container.innerHTML = '';

    try {
        const result = await executeCommand('pm list packages -3');
        
        if (!result.success || !result.output) {
            showAlert('获取应用列表失败', 'error');
            loader.style.display = 'none';
            return;
        }

        // Parse packages
        const apps = result.output
            .split('\n')
            .map(line => line.replace('package:', '').trim())
            .filter(pkg => pkg && /^[a-zA-Z0-9._-]+$/.test(pkg))
            .sort();

        if (apps.length === 0) {
            showAlert('未找到第三方应用', 'warning');
            loader.style.display = 'none';
            return;
        }

        // Load current whitelist
        const wlResult = await executeCommand(`cat ${CONFIG.WHITELIST_FILE}`);
        const whitelisted = new Set();
        
        if (wlResult.success && wlResult.output) {
            wlResult.output.split('\n').forEach(pkg => {
                const trimmed = pkg.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    whitelisted.add(trimmed);
                }
            });
        }

        // Render apps in batches
        let html = '';
        const batchSize = 50;
        
        for (let i = 0; i < apps.length; i++) {
            const pkg = apps[i];
            const id = `app_${i}`;
            const checked = whitelisted.has(pkg) ? 'checked' : '';
            
            html += `
                <div class="app-item">
                    <input type="checkbox" id="${id}" value="${escapeHtml(pkg)}" ${checked}>
                    <label for="${id}">${escapeHtml(pkg)}</label>
                </div>
            `;

            // Batch render
            if ((i + 1) % batchSize === 0 || i === apps.length - 1) {
                container.innerHTML += html;
                html = '';
                await new Promise(r => setTimeout(r, 0));
            }
        }

        loader.style.display = 'none';
        container.style.display = 'block';
        showAlert(`已加载 ${apps.length} 个应用`, 'success');

    } catch (e) {
        console.error('Error loading apps:', e);
        showAlert('加载失败: ' + e.message, 'error');
        loader.style.display = 'none';
    }
}

/**
 * Save whitelist
 */
async function saveWhitelist() {
    const checkboxes = document.querySelectorAll('#appListContainer input:checked');
    const apps = Array.from(checkboxes).map(cb => cb.value);

    if (apps.length === 0) {
        showAlert('请至少选择一个应用', 'info');
        return;
    }

    try {
        const content = apps.join('\n');
        const cmd = `cat > ${CONFIG.WHITELIST_FILE} << 'WHITELIST_EOF'\n${content}\nWHITELIST_EOF`;
        const result = await executeCommand(cmd);

        if (result.success) {
            showAlert(`已保存 ${apps.length} 个应用到白名单`, 'success');
        } else {
            showAlert('保存失败: ' + result.error, 'error');
        }
    } catch (e) {
        console.error('Error saving:', e);
        showAlert('保存出错: ' + e.message, 'error');
    }
}

/**
 * Clear whitelist
 */
async function clearWhitelist() {
    if (!confirm('确定要清空白名单吗?')) return;

    try {
        const result = await executeCommand(`rm -f ${CONFIG.WHITELIST_FILE}`);
        
        if (result.success) {
            document.querySelectorAll('#appListContainer input').forEach(cb => {
                cb.checked = false;
            });
            showAlert('已清空白名单', 'success');
        } else {
            showAlert('清空失败: ' + result.error, 'error');
        }
    } catch (e) {
        console.error('Error clearing:', e);
        showAlert('清空出错: ' + e.message, 'error');
    }
}

/**
 * Reload apps list
 */
async function reloadApps() {
    await loadApplications();
}

/**
 * Update system status
 */
async function updateStatus() {
    try {
        // Get GPS status
        const gpsResult = await executeCommand('settings get secure location_mode');
        const gpsEl = document.getElementById('gpsStatus');
        
        if (gpsResult.success && gpsResult.output) {
            const mode = parseInt(gpsResult.output.trim());
            gpsEl.textContent = mode > 0 ? '✓ 已开启' : '✗ 已关闭';
            gpsEl.style.color = mode > 0 ? '#4caf50' : '#ff6b6b';
        } else {
            gpsEl.textContent = '✗ 已关闭';
            gpsEl.style.color = '#ff6b6b';
        }

        // Get screen state
        const screenResult = await executeCommand('dumpsys display');
        const screenEl = document.getElementById('screenStatus');
        
        if (screenResult.success && screenResult.output) {
            const isOn = screenResult.output.includes('mScreenState=ON') || screenResult.output.includes('ON');
            screenEl.textContent = isOn ? '✓ 亮屏' : '✗ 熄屏';
            screenEl.style.color = isOn ? '#4caf50' : '#ff9800';
        } else {
            screenEl.textContent = '✗ 熄屏';
            screenEl.style.color = '#ff9800';
        }

        // Get foreground app
        const fgResult = await executeCommand('dumpsys window windows');
        const fgEl = document.getElementById('fgApp');
        
        if (fgResult.success && fgResult.output) {
            const match = fgResult.output.match(/([a-zA-Z0-9._-]+)\//m);
            const pkg = match ? match[1] : '无';
            fgEl.textContent = pkg;
        } else {
            fgEl.textContent = '无';
        }
        fgEl.style.color = '#64c8ff';

    } catch (e) {
        console.error('Status update error:', e);
    }
}

/**
 * Show alert message
 */
function showAlert(msg, type = 'info') {
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.textContent = msg;
    alert.style.animation = 'slideIn 0.3s ease';
    
    const container = document.querySelector('.control-card');
    if (container) {
        container.insertBefore(alert, container.firstChild);
        setTimeout(() => {
            try { alert.remove(); } catch (e) {}
        }, 3000);
    }
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

/**
 * Initialize on load
 */
document.addEventListener('DOMContentLoaded', () => {
    // Search filter
    const search = document.getElementById('searchInput');
    if (search) {
        search.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            document.querySelectorAll('.app-item').forEach(item => {
                const text = item.textContent.toLowerCase();
                item.style.display = text.includes(query) ? 'flex' : 'none';
            });
        });
    }

    // Add animation keyframes
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
        }
    `;
    document.head.appendChild(style);
});

window.addEventListener('load', () => {
    console.log('GPS Control v4.0 initialized');
    loadApplications();
    updateStatus();
    
    // Update status periodically
    if (statusUpdateInterval) clearInterval(statusUpdateInterval);
    statusUpdateInterval = setInterval(updateStatus, CONFIG.STATUS_UPDATE_INTERVAL);
});

window.addEventListener('beforeunload', () => {
    if (statusUpdateInterval) clearInterval(statusUpdateInterval);
});
