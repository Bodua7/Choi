import { GameState } from './core/state.js';
import { ResurrectionManager } from './core/resurrection.js';
import { formatBigNumber } from './ui/formatter.js';
import { renderTabContent } from './ui/panels.js';
import { ACHIEVEMENTS } from './core/achievements.js';
import { playSfx } from './audio/sfx.js';
import { getSkinById } from './core/skin.js';
import {
    ensurePlayerId,
    getDisplayName,
    setDisplayName,
    submitScore,
    fetchTop
} from './net/leaderboard.js';
import {
    fetchWorldBoss,
    dealWorldBossDamage,
    fetchWorldBossTop,
    advanceWorldBossCycle
} from './net/worldBoss.js';
import {
    fetchArenaOpponents,
    recordArenaMatch,
    fetchArenaDefenseLog
} from './net/arenaPvp.js';
import {
    isPushSupported,
    getPermissionState,
    enablePush,
    disablePush,
    isPushEnabled,
    showLocalNotification
} from './net/push.js';
import { dbGet, dbSet, dbRemove, migrateFromLocalStorage } from './core/db.js';
import { TICKET_MAX } from './core/arena.js';

// --- Cài Đặt sớm phiên đăng nhập ẩn danh Supabase ---
ensurePlayerId();

// --- Game systems ---
const state = new GameState();
const resurrection = new ResurrectionManager();

// --- Cài Đặt: âm thanh (chỉ lưu lựa chọn — chưa có file audio thật trong dự án) ---
// isSoundOn()/toggleSound() cần đọc/ghi ĐỒNG BỘ cho UI (panels.js đổi text nút
// ngay sau khi bấm) trong khi IndexedDB là API bất đồng bộ — nên giữ `soundOn`
// làm cache trong bộ nhớ, mặc định true, rồi nạp lại giá trị thật đã lưu ngay khi
// module này chạy (gần như luôn kịp trước khi người chơi mở tab Cài Đặt).
const SOUND_KEY = 'zombie-stickman-sound-on';
let soundOn = true;
migrateFromLocalStorage(SOUND_KEY).then(() =>
    dbGet(SOUND_KEY).then((v) => { if (v !== null) soundOn = v !== false; })
);

function showAchievementToast(ids) {
    const names = ids.map(id => ACHIEVEMENTS.find(a => a.id === id)?.name || id);
    const toast = document.getElementById('achievement-toast');
    toast.textContent = `Thành Tựu mới: ${names.join(', ')}`;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 6000);
}

function showOfflineToast(elapsedSeconds, gained) {
    if (!gained) return;
    const toast = document.getElementById('offline-toast');
    const mins = Math.floor(elapsedSeconds / 60);
    toast.textContent = `Chào mừng trở lại! Vắng mặt ${mins} phút — nhận: ` +
        `${formatBigNumber(gained.wood)} Gỗ, ${formatBigNumber(gained.stone)} Đá, ` +
        `${formatBigNumber(gained.core)} Lõi, ${formatBigNumber(gained.crystal)} Tinh Thạch`;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 6000);
}

// Load save (IndexedDB, bất đồng bộ), tính tài nguyên treo máy offline bằng công
// thức O(1). Gói trong 1 hàm async gọi ngay (không dùng top-level await để tương
// thích rộng hơn với target build của Vite) — các phần đăng ký sự kiện/vòng lặp
// bên dưới không cần chờ hàm này xong, chỉ cần state đã sẵn sàng trước khi người
// chơi thật sự tương tác (rất nhanh trong thực tế với IndexedDB).
async function initSaveData() {
    const elapsedOffline = await state.load();
    if (elapsedOffline !== null && elapsedOffline > 1) {
        const gained = state.applyElapsedSeconds(Math.min(elapsedOffline, 60 * 60 * 24)); // giới hạn hiển thị 24h/lần
        showOfflineToast(elapsedOffline, gained);
    }
    state.checkAchievements(); // đồng bộ Thành Tựu ngay khi mở app (save cũ có thể đã đủ điều kiện)
    updateTopBar();
    refreshSwarmStatus();
}
initSaveData();

// --- Top bar resource display ---
function updateTopBar() {
    document.getElementById('res-wood').textContent = formatBigNumber(state.resources.wood);
    document.getElementById('res-stone').textContent = formatBigNumber(state.resources.stone);
    document.getElementById('res-core').textContent = formatBigNumber(state.resources.core);
    document.getElementById('res-crystal').textContent = formatBigNumber(state.resources.crystal);
}
updateTopBar();

// --- Tab navigation ---
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanel = document.getElementById('tab-content-panel');
const tabContentEl = document.getElementById('tab-content');
let activeTab = null;

// --- Trạng thái Bầy Zombie (thay viewport 3D bằng text) ---
const MAX_LOG_ENTRIES = 40;
const logEl = document.getElementById('combat-log');

// type: 'win' | 'lose' | 'info' — quyết định màu viền dòng log
function addLogEntry(text, type = 'info') {
    const li = document.createElement('li');
    li.className = `log-${type}`;
    li.textContent = text;
    logEl.appendChild(li);
    while (logEl.children.length > MAX_LOG_ENTRIES) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
}

// Rút gọn số lượng hiển thị (giữ nguyên logic cũ từ condenser.js đã gỡ bỏ)
function formatCount(n) {
    if (n < 1000) return String(n);
    const units = ['K', 'M', 'B', 'T'];
    let unitIndex = -1;
    let value = n;
    while (value >= 1000 && unitIndex < units.length - 1) {
        value /= 1000;
        unitIndex++;
    }
    return `${value.toFixed(1)}${units[unitIndex]}`;
}

function refreshSwarmStatus() {
    const region = state.getCurrentRegion();
    const evo = state.getEvolutionStage();
    const evoColorNum = evo.colorHex || parseInt(region.allyFaction.color.replace('#', '0x'));
    const skin = getSkinById(state.selectedSkin);
    const finalColorNum = skin.color !== null ? skin.color : evoColorNum;
    const finalColor = '#' + finalColorNum.toString(16).padStart(6, '0');

    const summaryEl = document.getElementById('swarm-summary');
    summaryEl.innerHTML = `
        <div class="swarm-title">
            <span class="swarm-dot" style="background:${finalColor}"></span>
            <span class="swarm-name">${evo.name}</span>
            <span class="swarm-count">x${formatCount(state.swarmCount)}</span>
        </div>
        <div class="swarm-line">${evo.role} — Vùng: ${region.name}</div>
        <div class="swarm-line">Tổng sát thương: ${formatBigNumber(state.getTotalAttack())}</div>
    `;
}
const panelCallbacks = {
    onStateChanged: () => {
        updateTopBar();
        refreshSwarmStatus();
        if (activeTab) renderTabContent(activeTab, state, tabContentEl, panelCallbacks);
    },
    getReviveQueueLength: () => resurrection.pendingQueue.length,
    playSfx: (name) => playSfx(name, soundOn),
    onSelectRegion: (regionId) => {
        if (state.setRegion(regionId)) panelCallbacks.onStateChanged();
    },
    onEnterDungeon: () => {
        // Phó bản: chiến đấu idle-tức-thì, so tổng sát thương với HP Boss của bậc hiện tại.
        // Thắng -> nhận thưởng + mở bậc kế tiếp. Thua -> một phần Phân Thân tử trận, chuyển
        // sang hàng chờ "Tái Tạo Data" (ResurrectionManager) thay vì mất vĩnh viễn.
        const result = state.enterDungeonStage(resurrection);
        playSfx(result.win ? 'dungeonWin' : 'dungeonLose', soundOn);
        updateTopBar();
        refreshSwarmStatus();
        if (result.win) {
            addLogEntry(`⚔ Bậc ${result.stageIndex + 1}: Bầy Zombie đè bẹp Boss! Mở khóa Bậc ${result.stageIndex + 2}.`, 'win');
            if (result.evolvedTo) addLogEntry(`✨ Phân Thân tiến hóa thành ${result.evolvedTo.name}!`, 'win');
            if (result.storyBeat) addLogEntry(`📖 Ch.${result.storyBeat.chapter}: ${result.storyBeat.text}`, 'info');
        } else {
            addLogEntry(`💀 Bậc ${result.stageIndex + 1}: Thất thủ trước Boss — ${result.deaths} Phân Thân chuyển sang Tái Tạo Data.`, 'lose');
        }
        const newAchievements = state.checkAchievements();
        if (newAchievements.length > 0) { playSfx('achievement', soundOn); showAchievementToast(newAchievements); }
        renderTabContent('dungeon', state, tabContentEl, panelCallbacks);
        // Chỉ báo khi tab đang ẩn (đang treo máy nền) — tránh spam thông báo lúc
        // người chơi đang trực tiếp bấm vào Phó Bản và đã thấy kết quả trên màn hình
        if (result.win && document.hidden) {
            showLocalNotification('Vượt Phó Bản thành công!', {
                body: `Đã mở Bậc ${result.stageIndex + 2}. Quay lại game để tiếp tục chinh phục.`,
                tag: 'dungeon-win'
            });
        }
    },
    // --- Bảng Xếp Hạng (Supabase) ---
    // getLocalPlayerId giờ là async (đăng nhập ẩn danh thật, xem net/leaderboard.js)
    getLocalPlayerId: () => ensurePlayerId(),
    getDisplayName,
    setDisplayName,
    submitLeaderboardScore: () => submitScore(state),
    fetchLeaderboard: () => fetchTop(20),
    // --- Boss Cốt Truyện chung server (Supabase) ---
    fetchWorldBoss: () => fetchWorldBoss(),
    attackWorldBoss: (damage) => dealWorldBossDamage(damage),
    fetchWorldBossTop: (cycleNumber) => fetchWorldBossTop(cycleNumber),
    advanceWorldBoss: () => advanceWorldBossCycle(),
    // --- Đấu Trường PvP thật (bất đồng bộ, snapshot BXH qua Supabase) ---
    fetchArenaOpponents: (myAttack) => fetchArenaOpponents(myAttack),
    recordArenaMatch: (args) => recordArenaMatch(args),
    fetchArenaDefenseLog: () => fetchArenaDefenseLog(),
    // --- Cài Đặt ---
    isSoundOn: () => soundOn,
    toggleSound: () => {
        soundOn = !soundOn;
        dbSet(SOUND_KEY, soundOn); // ghi IndexedDB bất đồng bộ, không chặn đổi text nút
    },
    exportSave: async () => {
        await state.save();
        const data = await dbGet('zombie-stickman-save-v1');
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `zombie-stickman-save-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },
    importSave: (file) => {
        const reader = new FileReader();
        reader.onload = async () => {
            let parsed;
            try {
                parsed = JSON.parse(reader.result); // validate trước khi ghi đè save hiện tại
            } catch (e) {
                alert('File save không hợp lệ (không phải JSON đúng định dạng).');
                return;
            }
            if (!confirm('Nhập save này sẽ GHI ĐÈ tiến độ hiện tại. Tiếp tục?')) return;
            await dbSet('zombie-stickman-save-v1', parsed);
            location.reload();
        };
        reader.readAsText(file);
    },
    resetProgress: async () => {
        await dbRemove('zombie-stickman-save-v1');
        location.reload();
    },
    // --- Thông báo (Web Push + cục bộ) ---
    isPushSupported,
    getPushPermission: getPermissionState,
    isPushEnabled,
    enablePush,
    disablePush
};

tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const tabKey = btn.dataset.tab;
        if (activeTab === tabKey && !tabPanel.classList.contains('hidden')) {
            // Bấm lại tab đang mở -> đóng panel
            tabPanel.classList.add('hidden');
            activeTab = null;
            tabButtons.forEach(b => b.classList.remove('active'));
            return;
        }
        activeTab = tabKey;
        tabButtons.forEach(b => b.classList.toggle('active', b === btn));
        renderTabContent(tabKey, state, tabContentEl, panelCallbacks);
        tabPanel.classList.remove('hidden');
    });
});

// --- Nút Quét Sạch (Sweep All) ---
document.getElementById('btn-sweep').addEventListener('click', () => {
    // Quét sạch: cộng dồn ngay 10 giây sản lượng tại chỗ (không tự thêm quân —
    // muốn tăng Bầy Zombie hãy dùng nút Chiêu Mộ trong tab Căn Cứ)
    state.applyElapsedSeconds(10);
    updateTopBar();
    if (activeTab) renderTabContent(activeTab, state, tabContentEl, panelCallbacks);
});

// --- Vòng lặp chính (không còn vẽ khung hình 3D -> dùng interval thay vì rAF) ---
let lastTickTime = Date.now();
function tick() {
    const now = Date.now();
    const wholeSeconds = Math.max(1, Math.round((now - lastTickTime) / 1000)); // bù trễ do tab nền bị trình duyệt throttle interval
    lastTickTime = now;
    state.applyElapsedSeconds(wholeSeconds);
    const ticketsBefore = state.arena.tickets;
    state.arena.regenTickets();
    if (ticketsBefore < TICKET_MAX && state.arena.tickets >= TICKET_MAX && document.hidden) {
        showLocalNotification('Vé Đấu Trường đã đầy!', {
            body: `Bạn đang có ${TICKET_MAX}/${TICKET_MAX} vé — quay lại thách đấu trước khi bỏ lỡ.`,
            tag: 'arena-tickets-full'
        });
    }
    updateTopBar();
    let revived = 0;
    resurrection.processQueue(() => { state.swarmCount += 1; revived += 1; });
    if (revived > 0) {
        refreshSwarmStatus();
        addLogEntry(`🧟 ${revived} Phân Thân đã Tái Tạo Data xong, quay lại Bầy.`, 'win');
        if (activeTab === 'dungeon') renderTabContent('dungeon', state, tabContentEl, panelCallbacks);
        if (document.hidden) {
            showLocalNotification('Phân Thân đã hồi sinh!', {
                body: `${revived} Phân Thân vừa Tái Tạo Data xong, sẵn sàng chiến đấu trở lại.`,
                tag: 'resurrection-done'
            });
        }
    }
    const newAchievements = state.checkAchievements();
    if (newAchievements.length > 0) { playSfx('achievement', soundOn); showAchievementToast(newAchievements); }
}
setInterval(tick, 1000);

// Cập nhật bảng trạng thái Bầy Zombie định kỳ (đổi vùng/tiến hóa/skin có thể xảy ra
// từ panel khác nên vẫn cần refresh theo chu kỳ, không chỉ theo sự kiện)
refreshSwarmStatus();
setInterval(refreshSwarmStatus, 3000);
addLogEntry('🎮 Chào mừng trở lại Server 8. Bầy Zombie đang chờ lệnh.', 'info');

// --- Auto-save mỗi 15 giây + khi rời trang ---
// state.save() giờ là async (ghi IndexedDB) — không await ở đây vì:
// - setInterval: fire-and-forget là đủ, lần lưu kế tiếp 15s sau sẽ bù nếu có lỡ.
// - beforeunload: trình duyệt không chờ Promise trong sự kiện này nên await cũng
//   vô ích; visibilitychange (khi tab bị ẩn/chuyển nền) mới là điểm lưu đáng tin
//   cậy nhất trên mobile (theo khuyến nghị chuẩn PWA), giữ lại beforeunload chỉ
//   như lớp phòng hờ thêm trên desktop.
setInterval(() => state.save(), 15000);
window.addEventListener('beforeunload', () => state.save());
window.addEventListener('visibilitychange', () => { if (document.hidden) state.save(); });

// --- Đăng ký Service Worker cho PWA offline thật ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(err => {
            console.warn('Service worker registration failed:', err);
        });
    });
}
