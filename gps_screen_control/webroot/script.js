// GPS Screen Control v3.1 - Core JavaScript Bridge
// Completely rewritten for better KernelSU/APatch compatibility

const MODULE_DIR = '/data/adb/modules/gps_screen_control';
const WHITELIST_FILE = `${MODULE_DIR}/whitelist.txt`;

/**
 * Simple root command executor
 */
function executeShellCommand(cmd) {
    return new Promise((resolve) => {
        try {
            // Try KernelSU first
            if (window.ksu && typeof window.ksu.exec === 'function') {
                window.ksu.exec(cmd, (output) => {
                    resolve({
                        success: true,
                        output: output || ''
                    });
                });
            }
            // Fallback to su
            else if (window.su && typeof window.su.exec === 'function') {
                window.su.exec(cmd, (output) => {
                    resolve({
                        success: true,
                        output: output || ''
                    });
                });
            }
            else {
                resolve({
                    success: false,
                    output: 'No root interface'
                });
            }
        } catch (e) {
            console.error('Command error:', e);
            resolve({
                success: false,
                output: e.toString()
            });
        }
    });
}

/**
 * Load third-party apps
 */
async function loadApplications() {
    const loadingEl = document.getElementById('loadingIndicator');
    const containerEl = document.getElementById('appListContainer');
    
    loadingEl.style.display = 'flex';
    containerEl.style.display = 'none';

    try {
        const result = await executeShellCommand('pm list packages -3');
        
        if (!result.success) {
            showAlert('获取应用列表失败', 'error');
            loadingEl.style.display = 'none';
            return;
        }

        const apps = result.output
            .split('\n')
            .map(line => line.replace('package:', '').trim())
            .filter(pkg => pkg && /^[a-zA-Z0-9._]+$/.test(pkg))
            .sort();

        if (apps.length === 0) {
            showAlert('未找到应用', 'warning');
            loadingEl.style.display = 'none';
            return;
        }

        // Load whitelist
        const whitelistResult = await executeShellCommand(`cat ${WHITELIST_FILE}`);
        const whitelisted = new Set();
        
        if (whitelistResult.success && whitelistResult.output) {
            whitelistResult.output.split('\n').forEach(pkg => {
                if (pkg.trim()) whitelisted.add(pkg.trim());
            });
        }

        // Render apps
        let html = '';
        apps.forEach(pkg => {
            const checked = whitelisted.has(pkg) ? 'checked' : '';
            html += `
                <div class="app-item">
                    <input type="checkbox" value="${pkg}" ${checked}>
                    <label>${pkg}</label>
                </div>
            `;
        });

        containerEl.innerHTML = html;
        loadingEl.style.display = 'none';
        containerEl.style.display = 'block';
        showAlert(`已加载 ${apps.length} 个应用`, 'success');

    } catch (e) {
        console.error('Load apps error:', e);
        showAlert('加载失败: ' + e.message, 'error');
        loadingEl.style.display = 'none';
    }
}

/**
 * Save whitelist
 */
async function saveWhitelist() {
    const checkboxes = document.querySelectorAll('#appListContainer input:checked');
    const apps = Array.from(checkboxes).map(cb => cb.value);

    if (apps.length === 0) {
        showAlert('请选择至少一个应用', 'info');
        return;
    }

    try {
        const content = apps.join('\n');
        const cmd = `cat > ${WHITELIST_FILE} << 'EOF'\n${content}\nEOF`;
        const result = await executeShellCommand(cmd);

        if (result.success) {
            showAlert(`已保存 ${apps.length} 个应用`, 'success');
        } else {
            showAlert('保存失败', 'error');
        }
    } catch (e) {
        showAlert('保存出错: ' + e.message, 'error');
    }
}

/**
 * Clear whitelist
 */
async function clearWhitelist() {
    if (!confirm('确定清空白名单?')) return;

    try {
        const result = await executeShellCommand(`rm -f ${WHITELIST_FILE}`);
        
        if (result.success) {
            document.querySelectorAll('#appListContainer input').forEach(cb => {
                cb.checked = false;
            });
            showAlert('已清空', 'success');
        } else {
            showAlert('清空失败', 'error');
        }
    } catch (e) {
        showAlert('清空出错: ' + e.message, 'error');
    }
}

/**
 * Update status (completely rewritten)
 */
async function updateStatus() {
    try {
        // Get GPS status
        const gpsCmd = 'settings get secure location_mode';
        const gpsResult = await executeShellCommand(gpsCmd);
        
        const gpsStatus = document.getElementById('gpsStatus');
        if (gpsResult.success && gpsResult.output) {
            const mode = parseInt(gpsResult.output.trim());
            if (mode > 0) {
                gpsStatus.textContent = '✓ 已开启';
                gpsStatus.style.color = '#4caf50';
            } else {
                gpsStatus.textContent = '✗ 已关闭';
                gpsStatus.style.color = '#ff6b6b';
            }
        } else {
            gpsStatus.textContent = '✗ 已关闭';
            gpsStatus.style.color = '#ff6b6b';
        }

        // Get screen state
        const screenCmd = 'dumpsys display | grep "mScreenState"';
        const screenResult = await executeShellCommand(screenCmd);
        
        const screenStatus = document.getElementById('screenStatus');
        if (screenResult.success && screenResult.output) {
            const isOn = screenResult.output.includes('ON');
            screenStatus.textContent = isOn ? '✓ 亮屏' : '✗ 熄屏';
            screenStatus.style.color = isOn ? '#4caf50' : '#ff9800';
        } else {
            screenStatus.textContent = '✗ 熄屏';
            screenStatus.style.color = '#ff9800';
        }

        // Get foreground app
        const fgCmd = 'dumpsys window windows | grep "mCurrentFocus"';
        const fgResult = await executeShellCommand(fgCmd);
        
        const fgStatus = document.getElementById('fgApp');
        if (fgResult.success && fgResult.output) {
            const match = fgResult.output.match(/([a-zA-Z0-9._]+)\//);
            fgStatus.textContent = match ? match[1] : '无';
        } else {
            fgStatus.textContent = '无';
        }
        fgStatus.style.color = '#64c8ff';

    } catch (e) {
        console.error('Status update error:', e);
    }
}

/**
 * Show alert
 */
function showAlert(msg, type = 'info') {
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.textContent = msg;
    alert.style.animation = 'slideIn 0.3s ease';
    
    const container = document.querySelector('.control-card');
    if (container) {
        container.insertBefore(alert, container.firstChild);
        setTimeout(() => alert.remove(), 3000);
    }
}

/**
 * Search filter
 */
document.addEventListener('DOMContentLoaded', () => {
    const search = document.getElementById('searchInput');
    if (search) {
        search.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            document.querySelectorAll('.app-item').forEach(item => {
                item.style.display = item.textContent.toLowerCase().includes(query) ? 'flex' : 'none';
            });
        });
    }
});

/**
 * Animation
 */
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
    }
`;
document.head.appendChild(style);

/**
 * Initialize
 */
window.addEventListener('load', () => {
    console.log('GPS Control v3.1 started');
    loadApplications();
    updateStatus();
    setInterval(updateStatus, 5000);
});
