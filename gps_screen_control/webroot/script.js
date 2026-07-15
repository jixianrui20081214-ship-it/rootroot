// GPS Screen Control v3.1 - Core JavaScript Bridge
// Optimized for KernelSU/APatch execution

const MODULE_DIR = '/data/adb/modules/gps_screen_control';
const WHITELIST_FILE = `${MODULE_DIR}/whitelist.txt`;

/**
 * Execute root command using KernelSU/APatch interface
 * @param {string} cmd - Command to execute
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
async function executeCommand(cmd) {
    return new Promise((resolve) => {
        try {
            if (window.ksu && window.ksu.exec) {
                window.ksu.exec(cmd, (res) => {
                    if (res && typeof res === 'object') {
                        resolve({
                            stdout: res.stdout || '',
                            stderr: res.stderr || '',
                            code: res.code || (res.stdout ? 0 : 1)
                        });
                    } else {
                        resolve({ stdout: res || '', stderr: '', code: 0 });
                    }
                });
            } else if (window.su && window.su.exec) {
                window.su.exec(cmd, (res) => {
                    resolve({
                        stdout: res || '',
                        stderr: '',
                        code: 0
                    });
                });
            } else {
                // Fallback for testing
                console.warn('No KSU/APatch interface available');
                resolve({ stdout: '', stderr: 'No root interface', code: 127 });
            }
        } catch (e) {
            console.error('Command execution error:', e);
            resolve({ stdout: '', stderr: e.toString(), code: 1 });
        }
    });
}

/**
 * Load all third-party applications
 * Optimized: Only loads user-installed (third-party) packages
 */
async function loadApplications() {
    const loadingEl = document.getElementById('loadingIndicator');
    const containerEl = document.getElementById('appListContainer');
    
    loadingEl.style.display = 'flex';
    containerEl.style.display = 'none';
    containerEl.innerHTML = '';

    try {
        // Execute optimized command: only get third-party packages (-3 flag)
        const result = await executeCommand('su -c "pm list packages -3"');
        
        if (result.code !== 0) {
            showAlert('Failed to load packages: ' + result.stderr, 'error');
            loadingEl.style.display = 'none';
            return;
        }

        // Parse packages with enhanced safety: skip empty lines, validate format
        const apps = [];
        const lines = result.stdout.split('\n');
        
        lines.forEach(line => {
            try {
                // Skip empty lines
                if (!line || !line.trim()) {
                    return;
                }
                
                // Check if line starts with package prefix
                if (line.startsWith('package:')) {
                    const pkg = line.replace('package:', '').trim();
                    // Additional validation: ensure package name is not empty
                    if (pkg && pkg.length > 0) {
                        apps.push(pkg);
                    }
                }
            } catch (e) {
                // Skip any malformed lines silently
                console.debug('Skipped line:', line);
            }
        });

        // Load current whitelist to check which apps are already selected
        const whitelistResult = await executeCommand(`su -c "cat ${WHITELIST_FILE} 2>/dev/null"`);
        const whitelistedApps = new Set();
        
        if (whitelistResult.code === 0 && whitelistResult.stdout) {
            whitelistResult.stdout.split('\n').forEach(line => {
                if (line && line.trim()) {
                    whitelistedApps.add(line.trim());
                }
            });
        }

        // Sort apps alphabetically
        apps.sort();

        // Render app list with checkboxes
        const html = apps.map(pkg => `
            <div class="app-item">
                <input type="checkbox" id="app_${escapeHtml(pkg)}" value="${escapeHtml(pkg)}" 
                       ${whitelistedApps.has(pkg) ? 'checked' : ''}>
                <label for="app_${escapeHtml(pkg)}">
                    <span class="app-name">${escapeHtml(pkg)}</span>
                    <span class="app-package">${escapeHtml(pkg)}</span>
                </label>
            </div>
        `).join('');

        containerEl.innerHTML = html;
        
        // Attach event listeners for dynamic filtering
        const checkboxes = containerEl.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
            cb.addEventListener('change', () => {
                // Optional: auto-save on change
                // saveWhitelist();
            });
        });

        loadingEl.style.display = 'none';
        containerEl.style.display = 'block';
        showAlert(`已加载 ${apps.length} 个第三方应用`, 'success');

    } catch (e) {
        console.error('Error loading applications:', e);
        showAlert('加载应用列表失败: ' + e.toString(), 'error');
        loadingEl.style.display = 'none';
    }
}

/**
 * Save selected apps to whitelist file
 */
async function saveWhitelist() {
    try {
        const checkboxes = document.querySelectorAll('#appListContainer input[type="checkbox"]:checked');
        const selectedApps = Array.from(checkboxes).map(cb => cb.value);

        if (selectedApps.length === 0) {
            showAlert('请至少选择一个应用', 'info');
            return;
        }

        const content = selectedApps.join('\n');
        
        // Write to whitelist file using root command
        // Escape content for shell
        const escapedContent = content.replace(/'/g, "'\"'\"'");
        const cmd = `su -c "echo '${escapedContent}' > ${WHITELIST_FILE}"`;
        
        const result = await executeCommand(cmd);
        
        if (result.code === 0) {
            showAlert(`✓ 已保存 ${selectedApps.length} 个应用到白名单`, 'success');
            console.log('Saved apps:', selectedApps);
        } else {
            showAlert('保存白名单失败: ' + result.stderr, 'error');
        }
    } catch (e) {
        console.error('Error saving whitelist:', e);
        showAlert('保存失败: ' + e.toString(), 'error');
    }
}

/**
 * Clear whitelist (delete file)
 */
async function clearWhitelist() {
    if (!confirm('确定要清空白名单吗？')) {
        return;
    }

    try {
        const result = await executeCommand(`su -c "rm -f ${WHITELIST_FILE}"`);
        
        if (result.code === 0) {
            // Uncheck all checkboxes
            document.querySelectorAll('#appListContainer input[type="checkbox"]').forEach(cb => {
                cb.checked = false;
            });
            showAlert('✓ 已清空白名单', 'success');
        } else {
            showAlert('清空失败: ' + result.stderr, 'error');
        }
    } catch (e) {
        console.error('Error clearing whitelist:', e);
        showAlert('清空失败: ' + e.toString(), 'error');
    }
}

/**
 * Update system status display
 */
async function updateStatus() {
    try {
        // Get GPS status
        const gpsResult = await executeCommand('su -c "settings get secure location_mode"');
        const gpsStatus = gpsResult.stdout ? parseInt(gpsResult.stdout.trim()) : 0;
        const gpsEnabled = gpsStatus > 0 ? '✓ 已开启' : '✗ 已关闭';
        document.getElementById('gpsStatus').textContent = gpsEnabled;
        document.getElementById('gpsStatus').style.color = gpsStatus > 0 ? '#4caf50' : '#ff6b6b';

        // Get screen state
        const screenResult = await executeCommand('dumpsys display | grep -i "mScreenState"');
        const screenOn = screenResult.stdout.includes('ON');
        const screenStatus = screenOn ? '✓ 亮屏' : '✗ 熄屏';
        document.getElementById('screenStatus').textContent = screenStatus;
        document.getElementById('screenStatus').style.color = screenOn ? '#4caf50' : '#ff9800';

        // Get foreground app
        const fgResult = await executeCommand('dumpsys window windows | grep -i "mCurrentFocus" | head -1');
        let fgApp = '无';
        if (fgResult.stdout) {
            const match = fgResult.stdout.match(/([a-zA-Z0-9._]+)\//);
            if (match) {
                fgApp = match[1];
            }
        }
        document.getElementById('fgApp').textContent = fgApp;
        document.getElementById('fgApp').style.color = '#64c8ff';

    } catch (e) {
        console.error('Error updating status:', e);
    }
}

/**
 * Show alert message
 */
function showAlert(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type}`;
    alertDiv.textContent = message;
    alertDiv.style.animation = 'slideIn 0.3s ease';
    
    const container = document.querySelector('.control-card');
    container.insertBefore(alertDiv, container.firstChild);
    
    setTimeout(() => {
        alertDiv.remove();
    }, 3000);
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * Filter apps by search input
 */
document.getElementById('searchInput')?.addEventListener('input', function(e) {
    const query = e.target.value.toLowerCase();
    const appItems = document.querySelectorAll('.app-item');
    
    appItems.forEach(item => {
        const label = item.textContent.toLowerCase();
        item.style.display = label.includes(query) ? 'flex' : 'none';
    });
});

/**
 * Add slide-in animation
 */
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            opacity: 0;
            transform: translateY(-10px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
`;
document.head.appendChild(style);

/**
 * Initialize on page load
 */
window.addEventListener('load', () => {
    console.log('GPS Control Module v3.1 Initialized');
    loadApplications();
    updateStatus();
    
    // Update status every 5 seconds
    setInterval(updateStatus, 5000);
});
