// State
let balance = 0; // in seconds
let currentTimer = null;
let activeMode = null; // Stores task id
let modeSeconds = 0;
let trueModeSeconds = 0;
let lastTickTime = 0;
let lastSaveTime = 0;

let gymTime = "15:00";
let plannerTime = "19:00";
let gymCooldownEnd = 0;
let gymModalTriggered = false;

// Dynamic Tasks
let tasks = [
    { id: 'mshp', name: 'Уроки МШП', ratio: 2.0, type: 'productive' },
    { id: 'reading', name: 'Чтение', ratio: 1.5, type: 'productive' },
    { id: 'gaming', name: 'Игры', ratio: 1.0, type: 'reward' }
];

let journal = [];

// Audio Beep
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playBeep() {
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.type = 'square';
    oscillator.frequency.value = 440;
    
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.05);
    gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.5);
    
    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.5);
}

// IPC Save/Load
function loadState() {
    if (window.pywebview && window.pywebview.api) {
        window.pywebview.api.load_state(function(response) {
            if (response) {
                try {
                    const state = JSON.parse(response);
                    if (state.balance !== undefined) balance = state.balance;
                    if (state.gymTime !== undefined) gymTime = state.gymTime;
                    if (state.plannerTime !== undefined) plannerTime = state.plannerTime;
                    if (state.gymCooldownEnd !== undefined) gymCooldownEnd = state.gymCooldownEnd;
                    if (state.gymModalTriggered !== undefined) gymModalTriggered = state.gymModalTriggered;
                    if (state.tasks && state.tasks.length > 0) tasks = state.tasks;
                    if (state.journal) journal = state.journal;
                } catch(e) {}
            }
            document.getElementById('gym-time-input').value = gymTime;
            document.getElementById('planner-time-input').value = plannerTime;
            
            updateBalanceDisplay();
            checkCooldown();
            renderTasks();
            renderJournal();
            updatePlanner();
        });
    }
}

function saveState() {
    const state = {
        balance, gymTime, plannerTime, gymCooldownEnd, gymModalTriggered, tasks, journal
    };
    if (window.pywebview && window.pywebview.api) {
        window.pywebview.api.save_state(JSON.stringify(state));
    }
}

// UI Tabs
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    
    document.getElementById('tab-' + tabId).classList.add('active');
    document.getElementById('nav-' + tabId).classList.add('active');
}

// Helpers
function formatTime(seconds) {
    const sAbs = Math.floor(Math.abs(seconds));
    const h = Math.floor(sAbs / 3600);
    const m = Math.floor((sAbs % 3600) / 60);
    const s = sAbs % 60;
    const sign = seconds < 0 ? '-' : '';
    return `${sign}${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatMinSec(seconds) {
    const sFloor = Math.floor(Math.abs(seconds));
    const m = Math.floor(sFloor / 60);
    const s = sFloor % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function getTaskById(id) {
    return tasks.find(t => t.id === id);
}

// Rendering
function renderTasks() {
    const container = document.getElementById('tasks-container');
    container.innerHTML = '';
    
    tasks.forEach(task => {
        const div = document.createElement('div');
        div.className = `timer-card ${task.type}`;
        div.id = `card-${task.id}`;
        if (activeMode === task.id) div.classList.add('active');
        
        div.innerHTML = `
            <h2>${task.name}</h2>
            <div class="time" id="time-${task.id}">${activeMode === task.id ? formatMinSec(modeSeconds) : '00:00'}</div>
            <button class="btn ${activeMode === task.id ? (task.type === 'reward' ? 'btn-red' : 'btn-secondary') : 'btn-start'}" onclick="toggleTimer('${task.id}')">${activeMode === task.id ? 'Стоп' : 'Старт'}</button>
            <div class="manual-adjust">
                <button class="btn-small" onclick="manualAdjust('${task.id}', -5)">-5м</button>
                <button class="btn-small" onclick="manualAdjust('${task.id}', 5)">+5м</button>
            </div>
        `;
        container.appendChild(div);
    });
    
    renderSettingsTasks();
}

function renderSettingsTasks() {
    const list = document.getElementById('settings-tasks-list');
    list.innerHTML = '';
    tasks.forEach(task => {
        const div = document.createElement('div');
        div.className = `task-item ${task.type}`;
        div.innerHTML = `
            <div class="task-item-info">
                <span class="task-item-name">${task.name}</span>
                <span class="task-item-ratio">${task.type === 'reward' ? 'Трата' : 'Коэф: ' + task.ratio}</span>
            </div>
            <button class="btn-delete" onclick="deleteTask('${task.id}')">✖</button>
        `;
        list.appendChild(div);
    });
}

function renderJournal() {
    const list = document.getElementById('journal-list');
    list.innerHTML = '';
    journal.forEach(entry => {
        const div = document.createElement('div');
        div.className = `journal-entry ${entry.type}`;
        div.innerHTML = `
            <span class="journal-time">${entry.time}</span>
            <span>${entry.text}</span>
        `;
        list.appendChild(div);
    });
}

function logAction(text, type='productive') {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    journal.unshift({ time: timeStr, text, type });
    if (journal.length > 100) journal.pop();
    
    saveState();
    renderJournal();
}

// Logic
function addTask() {
    const name = document.getElementById('new-task-name').value.trim();
    const ratio = parseFloat(document.getElementById('new-task-ratio').value) || 1.0;
    const type = document.getElementById('new-task-type').value;
    
    if (!name) return;
    const id = 'task_' + Date.now();
    tasks.push({ id, name, ratio, type });
    
    document.getElementById('new-task-name').value = '';
    document.getElementById('new-task-ratio').value = '';
    
    logAction(`Добавлено занятие: ${name}`, type);
    saveState();
    renderTasks();
}

function deleteTask(id) {
    if (activeMode === id) stopTimer();
    const task = getTaskById(id);
    if (task) logAction(`Удалено занятие: ${task.name}`, task.type);
    
    tasks = tasks.filter(t => t.id !== id);
    saveState();
    renderTasks();
}

function saveSettings() {
    gymTime = document.getElementById('gym-time-input').value;
    plannerTime = document.getElementById('planner-time-input').value;
    
    gymModalTriggered = false; 
    
    logAction(`Настройки сохранены`, 'productive');
    saveState();
    updatePlanner();
    
    // Switch back to dashboard implicitly
    switchTab('dashboard');
}

function manualAdjust(modeId, minutes) {
    const task = getTaskById(modeId);
    if (!task) return;
    
    const seconds = minutes * 60;
    if (task.type === 'reward') {
        balance += seconds;
    } else {
        balance += seconds / task.ratio;
    }
    
    const sign = minutes > 0 ? '+' : '';
    logAction(`Корректировка: ${task.name} (${sign}${minutes}м)`, task.type);
    
    updateBalanceDisplay();
    updatePlanner();
    saveState();
}

function toggleTimer(id) {
    const task = getTaskById(id);
    if (activeMode === id) {
        stopTimer();
    } else {
        if (activeMode) stopTimer();
        
        activeMode = id;
        modeSeconds = 0;
        trueModeSeconds = 0;
        lastTickTime = Date.now();
        lastSaveTime = Date.now();
        
        if (window.pywebview && window.pywebview.api) {
            window.pywebview.api.set_active_mode(id, task.type);
        }
        
        logAction(`Начало: ${task.name}`, task.type);
        renderTasks(); // Updates UI buttons
        
        document.getElementById('status-text').innerText = task.type === 'reward' ? 'Награда' : 'Фокус';
        document.getElementById('status-text').style.color = getProgressRingColor();
        
        currentTimer = setInterval(timerTick, 1000);
    }
}

function stopTimer() {
    if (!activeMode) return;
    const task = getTaskById(activeMode);
    
    clearInterval(currentTimer);
    
    if (task) {
        logAction(`Завершено: ${task.name} (${Math.floor(modeSeconds/60)}м)`, task.type);
    }
    
    document.getElementById('status-text').innerText = 'Ожидание';
    document.getElementById('status-text').style.color = 'var(--text-dim)';
    document.getElementById('progress-ring').style.strokeDashoffset = 326.72; // reset
    
    activeMode = null;
    modeSeconds = 0;
    
    if (window.pywebview && window.pywebview.api) {
        window.pywebview.api.set_active_mode("", "");
    }
    
    saveState();
    renderTasks();
}

function getProgressRingColor() {
    const task = getTaskById(activeMode);
    if (!task) return '#00ffcc';
    return task.type === 'reward' ? '#ff007f' : '#00ffcc';
}

function updateProgressRing() {
    const circle = document.getElementById('progress-ring');
    const radius = circle.r.baseVal.value;
    const circumference = radius * 2 * Math.PI;
    
    const progress = (modeSeconds % 60) / 60;
    const offset = circumference - progress * circumference;
    
    circle.style.strokeDashoffset = offset;
    circle.style.stroke = getProgressRingColor();
}

function updateTimerDisplay() {
    if (activeMode) {
        const timeEl = document.getElementById(`time-${activeMode}`);
        if (timeEl) timeEl.innerText = formatMinSec(modeSeconds);
    }
}

function updateBalanceDisplay() {
    const balanceEl = document.getElementById('balance-display');
    const debtTextEl = document.getElementById('debt-display');
    
    balanceEl.innerText = formatTime(balance);
    
    if (balance < 0) {
        balanceEl.classList.remove('neon-text');
        balanceEl.classList.add('neon-text-red');
        debtTextEl.innerText = `ОТРАБОТАТЬ: ${formatTime(balance)} ИГР. ДОЛГА`;
        debtTextEl.classList.remove('hidden');
    } else {
        balanceEl.classList.remove('neon-text-red');
        balanceEl.classList.add('neon-text');
        debtTextEl.innerText = `Доступно для игры`;
        debtTextEl.classList.add('hidden');
    }
}

// Integration callbacks
function startGamingTimer() {
    if (activeMode) {
        const task = getTaskById(activeMode);
        if (task && task.type === 'reward') return;
    }
    const gamingTask = tasks.find(t => t.type === 'reward');
    if (gamingTask) {
        toggleTimer(gamingTask.id);
    }
}

function showStrictAlert(msg) {
    document.getElementById('alert-text').innerText = msg;
    document.getElementById('alert-overlay').classList.remove('hidden');
}

function updatePlanner() {
    const plannerText = document.getElementById('planner-text');
    if (!plannerText) return;
    
    if (balance >= 0) {
        plannerText.innerText = "Баланс положительный. Свободное время!";
        plannerText.style.color = "var(--primary)";
        return;
    }
    
    const prodTasks = tasks.filter(t => t.type === 'productive');
    if (prodTasks.length === 0) {
        plannerText.innerText = "Нет занятий для развития!";
        return;
    }
    
    const bestTask = prodTasks.reduce((prev, curr) => (prev.ratio < curr.ratio) ? prev : curr);
    
    const secondsNeeded = Math.abs(balance) * bestTask.ratio;
    const minutesNeeded = Math.ceil(secondsNeeded / 60);
    
    const now = new Date();
    const [tH, tM] = plannerTime.split(':').map(Number);
    
    let target = new Date();
    target.setHours(tH, tM, 0, 0);
    
    let isTomorrow = false;
    if (target < now) {
        target.setDate(target.getDate() + 1);
        isTomorrow = true;
    }
    
    document.getElementById('planner-target-time').innerText = `до ${plannerTime}${isTomorrow ? ' (завтра)' : ''}`;
    
    const msLeft = target - now;
    const minutesLeft = Math.floor(msLeft / 60000);
    
    if (minutesNeeded > minutesLeft) {
        plannerText.innerText = `ВНИМАНИЕ! Требуется ${minutesNeeded}м (${bestTask.name}). Не успеваете!`;
        plannerText.style.color = "var(--secondary)";
    } else {
        plannerText.innerText = `Нужно уделить ${minutesNeeded}м на ${bestTask.name}.`;
        plannerText.style.color = "var(--text-main)";
    }
}

function timerTick() {
    if (!activeMode) return;
    
    const now = Date.now();
    const deltaMs = now - lastTickTime;
    if (deltaMs < 0) {
        lastTickTime = now;
        return;
    }
    
    const deltaSeconds = deltaMs / 1000.0;
    lastTickTime = now;
    
    trueModeSeconds += deltaSeconds;
    
    const newModeSeconds = Math.floor(trueModeSeconds);
    const didSecondChange = newModeSeconds > modeSeconds;
    modeSeconds = newModeSeconds;
    
    const task = getTaskById(activeMode);
    if (!task) {
        stopTimer();
        return;
    }
    
    if (task.type === 'reward') {
        balance -= deltaSeconds;
    } else {
        balance += deltaSeconds / task.ratio;
    }
    
    updateBalanceDisplay();
    
    // Update UI only when necessary to save CPU
    if (didSecondChange) {
        updateTimerDisplay();
        updateProgressRing();
        updatePlanner();
    }
    
    // Save state roughly every 10 seconds, regardless of throttling
    if (now - lastSaveTime >= 10000) {
        saveState();
        lastSaveTime = now;
    }
}

// Gym Logic
let isWindowLocked = false;
setInterval(() => {
    const now = new Date();
    const currentHM = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    if (currentHM === gymTime && !gymModalTriggered) {
        triggerGymModal();
    }

    if (currentHM === "00:00") {
        gymModalTriggered = false;
        saveState();
    }

    checkCooldown();
}, 1000);

function triggerGymModal() {
    if (activeMode) stopTimer();
    gymModalTriggered = true;
    saveState();
    document.getElementById('gym-overlay').classList.remove('hidden');
    document.getElementById('confirm-gym-btn').style.display = 'inline-block';
    document.getElementById('gym-cooldown').innerText = "Ожидание подтверждения...";
    
    if (!isWindowLocked && window.pywebview && pywebview.api) {
        pywebview.api.lock_window();
        isWindowLocked = true;
    }
}

function confirmGym() {
    gymCooldownEnd = Date.now() + 2 * 3600 * 1000;
    saveState();
    document.getElementById('confirm-gym-btn').style.display = 'none';
}

function checkCooldown() {
    const now = Date.now();
    if (gymCooldownEnd > now) {
        if (activeMode) stopTimer();
        
        document.getElementById('gym-overlay').classList.remove('hidden');
        document.getElementById('confirm-gym-btn').style.display = 'none';
        
        const remaining = Math.ceil((gymCooldownEnd - now) / 1000);
        document.getElementById('gym-cooldown').innerText = formatTime(remaining);
        
        if (!isWindowLocked && window.pywebview && pywebview.api) {
            pywebview.api.lock_window();
            isWindowLocked = true;
        }
    } else {
        if (gymCooldownEnd > 0) {
            gymCooldownEnd = 0;
            saveState();
        }
        if (!gymModalTriggered || gymCooldownEnd === 0) {
            document.getElementById('gym-overlay').classList.add('hidden');
            if (isWindowLocked && window.pywebview && pywebview.api) {
                pywebview.api.unlock_window();
                isWindowLocked = false;
            }
        }
    }
}

window.pywebview = { api: null };

window.addEventListener('DOMContentLoaded', () => {
    // Hide all tabs except active
    switchTab('dashboard');

    if (typeof qt !== "undefined" && typeof QWebChannel !== "undefined") {
        new QWebChannel(qt.webChannelTransport, function(channel) {
            window.pywebview.api = channel.objects.api;
            loadState();
        });
    }
});
