// GPS Screen Control v3.1 - Core JavaScript Bridge (FIXED)
// Optimized for KernelSU/APatch execution with proper timeout and error handling

const MODULE_DIR = '/data/adb/modules/gps_screen_control';
const WHITELIST_FILE = `${MODULE_DIR}/whitelist.txt`;
const COMMAND_TIMEOUT = 10000; // 10 second timeout for commands

/**
 * Execute root command using KernelSU/APatch interface with timeout
 * @param {string} cmd - Command to execute
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
async function executeCommand(cmd, timeout = COMMAND_TIMEOUT) {
    return new Promise((resolve) => {
        let timeoutHandle = null;
        let resolved = false;

        const finalize = (result) => {
            if (resolved) return;
            resolved = true;
            if (timeoutHandle) clearTimeout(timeoutHandle);
            resolve(result);
        };

        // Set timeout
        timeoutHandle = setTimeout(() => {
            finalize({
                stdout: '',
                stderr: 'Command execution timeout',
                code: 124
            });
        }, timeout);

        try {
            if (window.ksu && window.ksu.exec) {
                window.ksu.exec(cmd, (res) => {
                    if (res && typeof res === 'object') {
                        finalize({
                            stdout: res.stdout || '',
                            stderr: res.stderr || '',
                            code: res.code || (res.stdout ? 0 : 1)
                        });
                    } else {
                        finalize({
                            stdout: res || '',
                            stderr: '',
                            code: 0
                        });
                    }
                });
            } else if (window.su && window.su.exec) {
                window.su.exec(cmd, (res) => {
                    finalize({
                        stdout: res || '',
                        stderr: '',
                        code: 0
                    });
                });
            } else {
                // Fallback for testing
                console.warn('No KSU/APatch interface available');
                finalize({
                    stdout: '',
                    stderr: 'No root interface available',
                    code: 127
                });
            }
        } catch (e) {
            console.error('Command execution error:', e);
            finalize({
                stdout: '',
                stderr: e.toString(),
                code: 1
            });
        }
    });
}

/**
 * Load all third-party applications with error recovery
 */
async function loadApplications() {
    const loadingEl = document.getElementById('loadingIndicator');
    const containerEl = document.getElementById('appListContainer');
    
    loadingEl.style.display = 'flex';
    containerEl.style.display = 'none';
    containerEl.innerHTML = '';

    try {
        // Execute optimized command: only get third-party packages (-3 flag)
        // With shorter timeout specifically for this operation
        const result = await executeCommand('su -c "pm list packages -3"', 8000);
        
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
                    // Additional validation: ensure package name is not empty and contains valid chars
                    if (pkg && pkg.length > 0 && /^[a-zA-Z0-9._]+$/.test(pkg)) {
                        apps.push(pkg);
                    }
                }
            } catch (e) {
                // Skip any malformed lines silently
                console.debug('Skipped line:', line);
            }
        });

        // If no apps found, show warning
        if (apps.length === 0) {
            showAlert('未找到应用。请检查系统权限或重新启动应用。', 'warning');
            loadingEl.style.display = 'none';
            return;
        }

        // Load current whitelist to check which apps are already selected
        const whitelistResult = await executeCommand(`su -c "cat ${WHITELIST_FILE} 2>/dev/null"`, 5000);
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

        // Render app list with checkboxes in batches to avoid DOM blocking
        const batchSize = 100;
        let htmlContent = '';
        
        for (let i = 0; i < apps.length; i++) {
            const pkg = apps[i];
            const safeId = `app_${escapeHtml(pkg)}`;
            const isChecked = whitelistedApps.has(pkg) ? 'checked' : '';
            
            htmlContent += `
                <div class="app-item">
                    <input type="checkbox" id="${safeId}" value="${escapeHtml(pkg)}" ${isChecked}>
                    <label for="${safeId}">
                        <span class="app-name">${escapeHtml(pkg)}</span>
                        <span class="app-package">${escapeHtml(pkg)}</span>
                    </label>
                </div>
            `;

            // Render in batches
            if ((i + 1) % batchSize === 0 || i === apps.length - 1) {
                containerEl.innerHTML += htmlContent;
                htmlContent = '';
                // Allow UI to update
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

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
        showAlert(`✓ 已加载 ${apps.length} 个第三方应用`, 'success');

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
        // Use printf instead of echo for better compatibility
        const escapedContent = content.replace(/'/g, "'\\''");
        const cmd = `su -c "printf '%s' '${escapedContent}' > ${WHITELIST_FILE}"`;
        
        const result = await executeCommand(cmd, 5000);
        
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
        const result = await executeCommand(`su -c "rm -f ${WHITELIST_FILE}"`, 5000);
        
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
 * Update system status display with proper error handling
 */
async function updateStatus() {
    try {
        // Execute all status commands in parallel with shorter timeout
        const [gpsResult, screenResult, fgResult] = await Promise.all([
            executeCommand('su -c "settings get secure location_mode"', 5000),
            executeCommand('su -c "dumpsys display | grep -i mScreenState"', 5000),
            executeCommand('su -c "dumpsys window windows | grep -i mCurrentFocus | head -1"', 5000)
        ]);

        // Update GPS status
        if (gpsResult.code === 0 && gpsResult.stdout.trim()) {
            const gpsStatus = parseInt(gpsResult.stdout.trim());
            const gpsEnabled = gpsStatus > 0 ? '✓ 已开启' : '✗ 已关闭';
            document.getElementById('gpsStatus').textContent = gpsEnabled;
            document.getElementById('gpsStatus').style.color = gpsStatus > 0 ? '#4caf50' : '#ff6b6b';
        } else {
            document.getElementById('gpsStatus').textContent = '? 无法获取';
            document.getElementById('gpsStatus').style.color = '#ffb74d';
        }

        // Update screen state
        if (screenResult.code === 0) {
            const screenOn = screenResult.stdout.includes('ON');
            const screenStatus = screenOn ? '✓ 亮屏' : '✗ 熄屏';
            document.getElementById('screenStatus').textContent = screenStatus;
            document.getElementById('screenStatus').style.color = screenOn ? '#4caf50' : '#ff9800';
        } else {
            document.getElementById('screenStatus').textContent = '? 无法获取';
            document.getElementById('screenStatus').style.color = '#ffb74d';
        }

        // Update foreground app
        if (fgResult.code === 0 && fgResult.stdout) {
            const match = fgResult.stdout.match(/([a-zA-Z0-9._]+)\//);
            const fgApp = match ? match[1] : '无';
            document.getElementById('fgApp').textContent = fgApp;
            document.getElementById('fgApp').style.color = '#64c8ff';
        } else {
            document.getElementById('fgApp').textContent = '无';
            document.getElementById('fgApp').style.color = '#64c8ff';
        }

    } catch (e) {
        console.error('Error updating status:', e);
        // Set all to error state
        document.getElementById('gpsStatus').textContent = '✗ 错误';
        document.getElementById('screenStatus').textContent = '✗ 错误';
        document.getElementById('fgApp').textContent = '✗ 错误';
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
    if (container) {
        container.insertBefore(alertDiv, container.firstChild);
        
        setTimeout(() => {
            try {
                alertDiv.remove();
            } catch (e) {
                // Already removed
            }
        }, 3000);
    }
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
document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', function(e) {
            const query = e.target.value.toLowerCase();
            const appItems = document.querySelectorAll('.app-item');
            
            appItems.forEach(item => {
                const label = item.textContent.toLowerCase();
                item.style.display = label.includes(query) ? 'flex' : 'none';
            });
        });
    }
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
 * Initialize on page load with error recovery
 */
window.addEventListener('load', () => {
    console.log('GPS Control Module v3.1 Initialized (FIXED)');
    
    // Load applications
    loadApplications().catch(e => {
        console.error('Initial load failed:', e);
        showAlert('初始化应用列表失败，请点击「刷新列表」按钮重试', 'error');
    });
    
    // Update status immediately and then every 5 seconds
    updateStatus().catch(e => {
        console.error('Initial status update failed:', e);
    });
    
    const statusInterval = setInterval(() => {
        updateStatus().catch(e => {
            console.error('Status update failed:', e);
        });
    }, 5000);
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        clearInterval(statusInterval);
    });
});
