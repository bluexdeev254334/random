import { useEffect, useRef, useState } from 'react';
import {
  chooseNumber,
  createRound,
  getRemaining,
  getTargetRotation,
  loadDrawState,
  SEAT_COUNT,
  SEAT_LAYOUT,
  STORAGE_KEY,
  TEAM_DESK_SEATS,
  undoLatest,
  getWinningSeat,
  type DrawState,
} from './draw';

const COLORS = ['#e7a850', '#ec785f', '#d84c50', '#a94b63', '#536c83', '#448b83', '#7b9b68', '#c4a644'];
const SPIN_MS = 4400;

function readInitialState(): DrawState {
  try {
    return loadDrawState(window.localStorage);
  } catch {
    return createRound();
  }
}

function sectorPath(index: number, count: number): string {
  if (count === 1) return 'M 180 180 L 180 10 A 170 170 0 1 1 180 350 A 170 170 0 1 1 180 10 Z';
  const start = (index / count) * Math.PI * 2 - Math.PI / 2;
  const end = ((index + 1) / count) * Math.PI * 2 - Math.PI / 2;
  const x1 = 180 + 170 * Math.cos(start);
  const y1 = 180 + 170 * Math.sin(start);
  const x2 = 180 + 170 * Math.cos(end);
  const y2 = 180 + 170 * Math.sin(end);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return `M 180 180 L ${x1} ${y1} A 170 170 0 ${largeArc} 1 ${x2} ${y2} Z`;
}

function Wheel({ numbers, rotation, spinning }: { numbers: number[]; rotation: number; spinning: boolean }) {
  const slice = numbers.length ? 360 / numbers.length : 360;

  return (
    <div className={`wheel-frame${spinning ? ' wheel-frame--spinning' : ''}`}>
      <div className="wheel-pointer" aria-hidden="true" />
      <div className="wheel-rotor" style={{ transform: `rotate(${rotation}deg)` }}>
        <svg className="wheel-svg" viewBox="0 0 360 360" role="img" aria-label={`${numbers.length} số còn lại trên vòng quay`}>
          <circle cx="180" cy="180" r="176" className="wheel-rim" />
          {numbers.map((number, index) => {
            const middle = ((index + 0.5) * slice - 90) * (Math.PI / 180);
            const labelRadius = numbers.length < 8 ? 100 : numbers.length < 17 ? 115 : 126;
            const x = 180 + labelRadius * Math.cos(middle);
            const y = 180 + labelRadius * Math.sin(middle);
            const labelRotation = (index + 0.5) * slice;
            const fontSize = numbers.length > 25 ? 13 : numbers.length > 14 ? 15 : 18;

            return (
              <g key={number}>
                <path d={sectorPath(index, numbers.length)} fill={COLORS[index % COLORS.length]} className="wheel-sector" />
                {numbers.length <= 35 && (
                  <text
                    x={x}
                    y={y}
                    transform={`rotate(${labelRotation}, ${x}, ${y})`}
                    className="wheel-number"
                    style={{ fontSize }}
                  >
                    {number}
                  </text>
                )}
              </g>
            );
          })}
          <circle cx="180" cy="180" r="37" className="wheel-hub" />
          <circle cx="180" cy="180" r="5" className="wheel-hub-dot" />
        </svg>
      </div>
      <div className="wheel-shadow" aria-hidden="true" />
    </div>
  );
}

function App() {
  const [draw, setDraw] = useState<DrawState>(readInitialState);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [lastResult, setLastResult] = useState<number | null>(() => draw.history.at(-1) ?? null);
  const [focusedSeat, setFocusedSeat] = useState<number | null>(null);
  const [showAllResults, setShowAllResults] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const locked = useRef(false);
  const timer = useRef<number | null>(null);
  const soundEnabled = useRef(draw.soundEnabled);
  const remaining = getRemaining(draw);
  const latestNumber = draw.history.at(-1) ?? null;
  const highlightedNumber = focusedSeat === null ? lastResult : draw.assignments[focusedSeat];
  const highlightedSeat = highlightedNumber === null ? null : getWinningSeat(draw.assignments, highlightedNumber);
  const progress = (draw.history.length / SEAT_COUNT) * 100;

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draw));
    } catch {
      // The current draw remains usable when browser storage is unavailable.
    }
  }, [draw]);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (!showAllResults) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowAllResults(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showAllResults]);

  function playChime() {
    if (!soundEnabled.current) return;
    try {
      const audio = new AudioContext();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(660, audio.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(880, audio.currentTime + 0.12);
      gain.gain.setValueAtTime(0.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.13, audio.currentTime + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.34);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.35);
      oscillator.onended = () => void audio.close();
    } catch {
      // Audio is an enhancement; drawing does not depend on device audio support.
    }
  }

  function spin() {
    if (locked.current || remaining.length === 0) return;
    locked.current = true;
    setSpinning(true);
    setFocusedSeat(null);
    const result = chooseNumber(remaining);
    if (result === null) {
      locked.current = false;
      setSpinning(false);
      return;
    }

    const resultIndex = remaining.indexOf(result);
    setRotation(getTargetRotation(rotation, resultIndex, remaining.length));

    timer.current = window.setTimeout(() => {
      setDraw((current) => ({ ...current, history: [...current.history, result] }));
      setLastResult(result);
      setSpinning(false);
      locked.current = false;
      timer.current = null;
      playChime();
    }, SPIN_MS);
  }

  function createNewRound(clearStorage = false) {
    if (!window.confirm('Tạo lượt bốc mới? Phân bổ ghế và lịch sử hiện tại sẽ được thay thế.')) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    locked.current = false;
    setSpinning(false);
    setRotation(0);
    setDraw(createRound(draw.soundEnabled));
    setLastResult(null);
    setFocusedSeat(null);
    if (clearStorage) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // The fresh state will be saved by the persistence effect.
      }
    }
  }

  function clearDrawData() {
    if (!window.confirm('Xóa dữ liệu lượt bốc hiện tại và tạo sơ đồ ghế mới?')) return;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // The current page can still start a fresh round without browser storage.
    }
    if (timer.current !== null) window.clearTimeout(timer.current);
    locked.current = false;
    setSpinning(false);
    setRotation(0);
    setDraw(createRound(draw.soundEnabled));
    setLastResult(null);
    setFocusedSeat(null);
  }

  function undo() {
    if (locked.current || draw.history.length === 0) return;
    const updated = undoLatest(draw);
    setDraw(updated);
    setLastResult(updated.history.at(-1) ?? null);
    setFocusedSeat(null);
  }

  function toggleSound() {
    soundEnabled.current = !soundEnabled.current;
    setDraw((current) => ({ ...current, soundEnabled: soundEnabled.current }));
  }

  function renderSeat(seatIndex: number) {
    const number = draw.assignments[seatIndex];
    const selected = draw.history.includes(number);
    const current = number === latestNumber;
    const focused = seatIndex === focusedSeat || (focusedSeat === null && seatIndex === highlightedSeat);
    const classes = ['seat', selected ? 'seat--selected' : '', current ? 'seat--current' : '', focused ? 'seat--focused' : '']
      .filter(Boolean).join(' ');

    return (
      <button
        className={classes}
        key={seatIndex}
        type="button"
        aria-label={`Vị trí ${seatIndex + 1}, số ${number}, ${selected ? 'đã được chọn' : 'chưa được chọn'}`}
        aria-pressed={focused}
        onClick={() => setFocusedSeat(seatIndex)}
      >
        <span className="seat-index">VỊ TRÍ {String(seatIndex + 1).padStart(2, '0')}</span>
        <span className="seat-number">{number}</span>
        <span className="seat-state">{selected ? 'ĐÃ CHỌN' : 'CHƯA CHỌN'}</span>
      </button>
    );
  }

  return (
    <main className={darkMode ? 'app app--dark' : 'app'}>
      <div className="page-shell">
        <header className="topbar">
          <a className="brand-mark" href="#top" aria-label="11B7 Seat Draw, đầu trang">11<span>B7</span></a>
          <div className="brand-copy" id="top">
            <p className="eyebrow">CLASSROOM TOOLS / 2026</p>
            <h1>BỐC THĂM CHỖ NGỒI <span>— LỚP 11B7</span></h1>
          </div>
          <button className="icon-button sound-toggle" type="button" onClick={toggleSound} aria-label={draw.soundEnabled ? 'Tắt âm thanh' : 'Bật âm thanh'} title={draw.soundEnabled ? 'Tắt âm thanh' : 'Bật âm thanh'}>
            <span aria-hidden="true">{draw.soundEnabled ? '♪' : '♪̸'}</span>
            <span className="sound-copy">ÂM THANH</span>
            <span className={`toggle-track${draw.soundEnabled ? ' toggle-track--on' : ''}`} aria-hidden="true"><i /></span>
          </button>
          <button className="theme-toggle" type="button" onClick={() => setDarkMode((value) => !value)} aria-label={darkMode ? 'Chuyển sang nền sáng' : 'Chuyển sang nền tối'} title={darkMode ? 'Nền sáng' : 'Nền tối'}>
            <span aria-hidden="true">{darkMode ? '☀' : '◐'}</span>
          </button>
        </header>

        <section className="hero-grid" aria-label="Vòng quay và tiến trình bốc thăm">
          <section className="wheel-panel panel">
            <div className="section-heading">
              <div><p className="eyebrow">RANDOM DRAW / 01</p><h2>Vòng quay</h2></div>
              <span className={`live-status${spinning ? ' live-status--active' : ''}`}><i />{spinning ? 'ĐANG QUAY' : 'SẴN SÀNG'}</span>
            </div>

            <div className="wheel-stage">
              {remaining.length ? <Wheel numbers={remaining} rotation={rotation} spinning={spinning} /> : (
                <div className="empty-wheel"><span>35/35</span><strong>ĐÃ HOÀN THÀNH</strong></div>
              )}
              {lastResult !== null && !spinning && (
                <div className="result-pop" key={lastResult} aria-live="polite">
                  <span>SỐ VỪA CHỌN</span><strong>{lastResult}</strong><i />
                </div>
              )}
            </div>

            <div className="spin-actions">
              <button className="spin-button" type="button" onClick={spin} disabled={spinning || remaining.length === 0}>
                <span className="spin-icon" aria-hidden="true">{spinning ? '◌' : '↻'}</span>
                {spinning ? 'ĐANG QUAY...' : remaining.length ? 'QUAY' : 'ĐÃ HOÀN THÀNH'}
                <span className="key-hint">↵</span>
              </button>
              <p>{remaining.length ? 'Kết quả được khóa trước khi vòng quay bắt đầu.' : 'Đã hoàn thành bốc thăm 35/35.'}</p>
            </div>
          </section>

          <aside className="summary-column">
            <section className="result-panel panel">
              <div className="section-heading compact-heading"><div><p className="eyebrow">ROUND STATUS / 02</p><h2>Kết quả</h2></div><span className="round-number">LẦN {draw.history.length + (spinning ? 1 : 0)} / 35</span></div>
              <div className="latest-result" aria-live="polite">
                <div><span>KẾT QUẢ MỚI NHẤT</span><strong>{spinning ? '···' : latestNumber ?? '—'}</strong></div>
                <span className="result-caption">{spinning ? 'Đang xác định vị trí' : latestNumber ? `Vị trí ${String(draw.assignments.indexOf(latestNumber) + 1).padStart(2, '0')}` : 'Chưa có lượt quay'}</span>
              </div>
              <div className="stats-row">
                <div><span>ĐÃ CHỌN</span><strong>{draw.history.length}<small> / 35</small></strong></div>
                <div><span>CÒN LẠI</span><strong>{remaining.length}<small> số</small></strong></div>
              </div>
              <div className="progress-meta"><span>TIẾN ĐỘ</span><strong>{Math.round(progress)}%</strong></div>
              <div className="progress-track" role="progressbar" aria-label="Tiến độ bốc thăm" aria-valuenow={draw.history.length} aria-valuemin={0} aria-valuemax={SEAT_COUNT}><i style={{ width: `${progress}%` }} /></div>
              {remaining.length === 0 && <p className="complete-note">Đã hoàn thành bốc thăm 35/35</p>}
              <button className="text-button full-results-button" type="button" onClick={() => setShowAllResults(true)} disabled={draw.history.length === 0}>
                XEM TOÀN BỘ KẾT QUẢ <span aria-hidden="true">↗</span>
              </button>
            </section>

            <section className="remaining-panel panel">
              <div className="section-heading compact-heading"><div><p className="eyebrow">AVAILABLE / 03</p><h2>Số còn lại</h2></div><span className="count-badge">{remaining.length}</span></div>
              <div className="number-list" aria-label="Danh sách số chưa được chọn">
                {remaining.length ? remaining.map((number) => <span className="number-chip" key={number}>{number}</span>) : <p className="empty-list">Không còn số nào.</p>}
              </div>
            </section>
          </aside>
        </section>

        <section className="seating-panel panel" aria-labelledby="seating-title">
          <div className="section-heading seating-heading">
            <div><p className="eyebrow">CLASSROOM MAP / 04</p><h2 id="seating-title">Sơ đồ chỗ ngồi <span>35 vị trí</span></h2></div>
            <div className="seat-legend"><span><i className="legend-dot legend-dot--open" />Chưa chọn</span><span><i className="legend-dot legend-dot--done" />Đã chọn</span><span><i className="legend-dot legend-dot--current" />Vừa trúng</span></div>
          </div>
          <div className="classroom-scroll">
            <div className="classroom" aria-label="Sơ đồ lớp gồm bốn tổ, 22 bộ bàn và 35 vị trí">
              <div className="window-line" aria-hidden="true"><span>CỬA SỔ</span></div>
              <div className="team-grid">
                {TEAM_DESK_SEATS.map((desks, teamIndex) => (
                  <section className={`team-zone team-zone--${teamIndex + 1}`} key={teamIndex} aria-label={`Tổ ${teamIndex + 1}, ${desks.length} bộ bàn`}>
                    <header className="team-heading"><strong>TỔ {teamIndex + 1}</strong><span>{desks.length} BỘ BÀN</span></header>
                    <div className="desk-grid">
                      {desks.map((_, deskIndex) => (
                        <div className="table-unit" key={deskIndex}>
                          <span className="table-label">BÀN {String(deskIndex + 1).padStart(2, '0')}</span>
                          <div className="table-seats">{SEAT_LAYOUT[teamIndex][deskIndex].map(renderSeat)}</div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              <div className="teacher-zone">
                <div className="board-label"><span>BẢNG LỚP</span><i /></div>
                <div className="teacher-desk"><span>BÀN GIÁO VIÊN</span><i /></div>
                <div className="door-label"><i />CỬA RA VÀO</div>
              </div>
            </div>
          </div>
          {focusedSeat !== null && (
            <div className="seat-inspector" aria-live="polite">
              <span className="inspector-mark">{String(focusedSeat + 1).padStart(2, '0')}</span>
              <p><strong>Vị trí {focusedSeat + 1}</strong><span>Số {draw.assignments[focusedSeat]} · {draw.history.includes(draw.assignments[focusedSeat]) ? 'Đã được chọn' : 'Chưa được chọn'}</span></p>
              <button type="button" className="inspector-close" onClick={() => setFocusedSeat(null)} aria-label="Bỏ chọn vị trí">×</button>
            </div>
          )}
        </section>

        <section className="history-section" aria-labelledby="history-title">
          <div className="section-heading history-heading"><div><p className="eyebrow">DRAW LOG / 05</p><h2 id="history-title">Lịch sử lượt quay</h2></div><span className="history-total">{draw.history.length} KẾT QUẢ</span></div>
          {draw.history.length ? (
            <div className="history-list">
              {draw.history.map((number, index) => (
                <button className={`history-item${number === latestNumber ? ' history-item--latest' : ''}`} key={`${number}-${index}`} type="button" onClick={() => setFocusedSeat(draw.assignments.indexOf(number))}>
                  <span className="history-index">{String(index + 1).padStart(2, '0')}</span><span className="history-value">{number}</span><span className="history-seat">VỊ TRÍ {String(draw.assignments.indexOf(number) + 1).padStart(2, '0')}</span><span className="history-arrow" aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
          ) : <p className="history-empty">Kết quả sẽ xuất hiện tại đây sau lượt quay đầu tiên.</p>}
        </section>

        <footer className="management-bar">
          <div className="management-note"><i /> TIẾN TRÌNH ĐƯỢC LƯU TỰ ĐỘNG TRÊN THIẾT BỊ NÀY</div>
          <div className="management-actions">
            <button type="button" className="undo-button" onClick={undo} disabled={draw.history.length === 0 || spinning} title="Hoàn tác lượt gần nhất">↶ <span>HOÀN TÁC</span></button>
            <button type="button" className="shuffle-button" onClick={() => createNewRound(false)} disabled={spinning} title="Xáo trộn ghế trong lượt mới">↻ <span>XÁO TRỘN LẠI GHẾ</span></button>
            <button type="button" className="clear-button" onClick={clearDrawData} disabled={spinning} title="Xóa dữ liệu lượt bốc">× <span>XÓA DỮ LIỆU</span></button>
            <button type="button" className="reset-button" onClick={() => createNewRound(true)} disabled={spinning}>TẠO LƯỢT BỐC MỚI <span aria-hidden="true">↗</span></button>
          </div>
        </footer>
      </div>

      {showAllResults && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowAllResults(false); }}>
          <section className="results-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div className="section-heading"><div><p className="eyebrow">ROUND REPORT / 06</p><h2 id="modal-title">Toàn bộ kết quả</h2></div><button className="modal-close" type="button" onClick={() => setShowAllResults(false)} aria-label="Đóng">×</button></div>
            <p className="modal-summary">{draw.history.length} / 35 số đã được chọn · Nhấn kết quả để xem ghế trên sơ đồ.</p>
            <div className="modal-results">
              {draw.history.map((number, index) => (
                <button type="button" key={`${number}-${index}`} onClick={() => { setFocusedSeat(draw.assignments.indexOf(number)); setShowAllResults(false); }}>
                  <span>{String(index + 1).padStart(2, '0')}</span><strong>{number}</strong><small>VỊ TRÍ {String(draw.assignments.indexOf(number) + 1).padStart(2, '0')}</small>
                </button>
              ))}
            </div>
            <button className="modal-done" type="button" onClick={() => setShowAllResults(false)}>ĐÓNG</button>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;