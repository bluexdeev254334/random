import { useEffect, useState } from 'react';

type PublicSession = {
  user: { id: number; name: string } | null;
  hasSpun: boolean;
  lastResult: number | null;
  remaining: number[];
  settings?: {
    siteName: string;
    siteLogo: string;
    accentColor: string;
    fontFamily: string;
    soundEnabled: boolean;
    wheelDuration: number;
    publicNotice: string;
    spinLimitMode: string;
  };
};

type SpinHistoryItem = { selected_number: number; created_at: string };
type ClassroomLayout = {
  teacher: string;
  door: string;
  teams: { name: string; desks: { seats: number[] }[] }[];
};
type AdminIdentity = { id: number; username: string; fullName: string; role: string };
type LayoutVersion = { id: number; version_name: string; created_at: string; is_default: number; layout: ClassroomLayout };

function PublicApp() {
  const [name, setName] = useState('');
  const [session, setSession] = useState<PublicSession | null>(null);
  const [history, setHistory] = useState<SpinHistoryItem[]>([]);
  const [layout, setLayout] = useState<ClassroomLayout | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [wheelNumbers, setWheelNumbers] = useState<number[]>(Array.from({ length: 35 }, (_, index) => index + 1));
  const [rotation, setRotation] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [wheelDuration, setWheelDuration] = useState(4700);

  useEffect(() => {
    fetch('/api/public/state', { credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error('Public state request failed.');
        return res.json();
      })
      .then((data) => {
        setSession(data);
        setWheelNumbers(data.remaining);
        setSoundEnabled(data.settings?.soundEnabled ?? true);
        setWheelDuration(data.settings?.wheelDuration ?? 4700);
        if (data.user) setName(data.user.name);
      })
      .catch(() => setMessage('Không thể tải trạng thái lượt quay. Vui lòng tải lại trang.'));
    fetch('/api/public/history', { credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error('History request failed.');
        return res.json();
      })
      .then((data) => setHistory(data.items || []))
      .catch(() => setMessage('Không thể tải lịch sử quay của bạn.'));
    fetch('/api/public/layout', { credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error('Layout request failed.');
        return res.json();
      })
      .then((data) => setLayout(data.layout))
      .catch(() => setMessage('Không thể tải sơ đồ lớp học.'));
  }, []);

  useEffect(() => {
    const closeSession = () => {
      navigator.sendBeacon('/api/public/session/end', new Blob([], { type: 'application/json' }));
    };
    window.addEventListener('pagehide', closeSession);
    return () => window.removeEventListener('pagehide', closeSession);
  }, []);

  const submitName = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage('Vui lòng nhập họ tên của bạn trước khi tham gia.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/public/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || 'Không thể lưu tên người dùng.');
        return;
      }
      setSession(data);
      setWheelNumbers(data.remaining);
      setSoundEnabled(data.settings?.soundEnabled ?? true);
      setWheelDuration(data.settings?.wheelDuration ?? 4700);
      try {
        const historyResponse = await fetch('/api/public/history', { credentials: 'same-origin' });
        if (!historyResponse.ok) throw new Error('History request failed.');
        setHistory((await historyResponse.json()).items || []);
      } catch {
        setMessage('Tên đã được lưu nhưng không thể tải lịch sử quay.');
        return;
      }
      setMessage('Tên của bạn đã được lưu và phiên truy cập đã được ghi nhận.');
    } catch {
      setMessage('Không thể kết nối để lưu tên người dùng. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  const spinNow = async () => {
    if (loading || spinning) return;
    if (!session?.user) {
      setMessage('Vui lòng nhập và lưu họ tên trước khi quay số.');
      return;
    }
    if (session.hasSpun) {
      setMessage(session.settings?.spinLimitMode === 'account'
        ? 'Tài khoản này đã hoàn thành lượt quay.'
        : 'Bạn đã hoàn thành lượt quay. Mỗi địa chỉ IP chỉ được tham gia một lần.');
      return;
    }
    const spinPool = session.remaining;
    if (spinPool.length === 0) {
      setMessage('Tất cả 35 số đã được chọn. Lượt quay đã hoàn tất.');
      return;
    }
    setLoading(true);
    setSpinning(true);
    setWheelNumbers(spinPool);
    let audioContext: AudioContext | null = null;
    if (soundEnabled) {
      try {
        audioContext = new AudioContext();
        void audioContext.resume();
      } catch {
        audioContext = null;
      }
    }
    let res: Response;
    let data: { error?: string; selectedNumber?: number; remaining?: number[] };
    try {
      res = await fetch('/api/public/spin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({}),
      });
      data = await res.json();
    } catch {
      setLoading(false);
      setSpinning(false);
      if (audioContext) void audioContext.close();
      setMessage('Không thể kết nối để quay số. Vui lòng thử lại.');
      return;
    }
    setLoading(false);
    if (!res.ok) {
      setSpinning(false);
      if (audioContext) void audioContext.close();
      setMessage(data.error || 'Không thể quay số.');
      return;
    }
    if (typeof data.selectedNumber !== 'number' || !Number.isInteger(data.selectedNumber) || !Array.isArray(data.remaining)) {
      setSpinning(false);
      if (audioContext) void audioContext.close();
      setMessage('Máy chủ trả về kết quả không hợp lệ. Vui lòng tải lại trang.');
      return;
    }
    const selectedNumber = data.selectedNumber;
    const remaining = data.remaining;
    const winningIndex = spinPool.indexOf(selectedNumber);
    if (winningIndex < 0) {
      setSpinning(false);
      if (audioContext) void audioContext.close();
      setMessage('Máy chủ trả về số không còn trong lượt quay. Vui lòng tải lại trang.');
      return;
    }
    const sector = 360 / spinPool.length;
    const correction = ((-(rotation + (winningIndex + 0.5) * sector) % 360) + 360) % 360;
    setRotation(rotation + 360 * 7 + correction);
    window.setTimeout(async () => {
      setSession((previous) => previous ? { ...previous, hasSpun: true, lastResult: selectedNumber, remaining } : previous);
      setSpinning(false);
      setMessage(`Số trúng của bạn là ${selectedNumber}.`);
      try {
        const historyResponse = await fetch('/api/public/history', { credentials: 'same-origin' });
        if (!historyResponse.ok) throw new Error('History request failed.');
        setHistory((await historyResponse.json()).items || []);
      } catch {
        setMessage(`Số trúng của bạn là ${selectedNumber}; không thể tải lịch sử quay.`);
      }
      if (audioContext && audioContext.state !== 'closed') {
        const audio = audioContext;
        const oscillator = audio.createOscillator();
        const volume = audio.createGain();
        oscillator.frequency.value = 740;
        volume.gain.setValueAtTime(0.12, audio.currentTime);
        volume.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.28);
        oscillator.connect(volume);
        volume.connect(audio.destination);
        oscillator.start();
        oscillator.stop(audio.currentTime + 0.28);
        oscillator.onended = () => void audio.close();
      }
    }, wheelDuration);
  };

  const numbers = session ? session.remaining : Array.from({ length: 35 }, (_, index) => index + 1);
  const currentResult = session?.lastResult ?? null;

  return (
    <main
      className="public-shell"
      style={{
        '--primary': session?.settings?.accentColor || '#2457cc',
        fontFamily: `${session?.settings?.fontFamily || 'Manrope'}, sans-serif`,
      } as React.CSSProperties}
    >
      <header className="site-header">
        <div>
          {session?.settings?.siteLogo && <img className="site-logo" src={session.settings.siteLogo} alt="" />}
          <p className="top-tag">CLASSROOM DRAW SYSTEM</p>
          <h1>{session?.settings?.siteName || 'Bốc thăm chỗ ngồi lớp 11B7'}</h1>
        </div>
        <a href="/admin" className="admin-link">Trang quản trị</a>
      </header>
      {session?.settings?.publicNotice && <div className="status-bar public-notice" role="status">{session.settings.publicNotice}</div>}

      <section className="player-panel">
        <div className="player-card">
          <h2>Thông tin người tham gia</h2>
          <form onSubmit={submitName} className="name-form">
            <label>
              <span>Họ tên</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nhập họ tên của bạn" />
            </label>
            <button type="submit" disabled={loading}>{loading ? 'Đang lưu...' : 'Lưu tên'}</button>
          </form>
          <div className="session-box">
            {session?.user ? (<>
              <strong>{session.user.name}</strong>
              <span>{session.hasSpun ? 'Đã hoàn thành lượt quay' : 'Chưa quay'}</span>
            </>) : <span>Chưa có phiên truy cập nào.</span>}
          </div>
        </div>

        <div className="wheel-card">
          <button type="button" className="sound-toggle" aria-pressed={soundEnabled} onClick={() => setSoundEnabled((enabled) => !enabled)}>
            Âm thanh {soundEnabled ? 'bật' : 'tắt'}
          </button>
          <div className="wheel-wrapper">
            <div className={`wheel-inner${spinning ? ' wheel-inner--spinning' : ''}`} aria-label="Vòng quay số" style={{ transform: `rotate(${rotation}deg)`, transitionDuration: `${wheelDuration}ms` }}>
              {wheelNumbers.map((number, index) => {
                const angle = (360 / wheelNumbers.length) * (index + 0.5);
                return (
                <div key={number} className="wheel-number-slot" style={{ transform: `rotate(${angle}deg) translateY(calc(-1 * var(--wheel-radius))) rotate(${-angle}deg)` }}>
                  {number}
                </div>
              );})}
            </div>
            <div className="wheel-pointer" />
          </div>
          <button type="button" className="spin-trigger" onClick={spinNow} disabled={loading || spinning || !session?.user || session.hasSpun || numbers.length === 0}>
            {spinning ? 'Đang quay...' : session?.hasSpun ? 'Đã quay' : numbers.length === 0 ? 'Đã hết số' : 'Bắt đầu quay'}
          </button>
          {currentResult && <div className="result-banner">Số trúng: <strong>{currentResult}</strong></div>}
        </div>
      </section>

      <section className="status-bar">{message || 'Thông báo trạng thái lượt quay sẽ hiển thị ở đây.'}</section>

      <section className="numbers-panel">
        <div className="panel-heading">
          <h2>Danh sách số còn lại</h2>
          <span>{numbers.length}/35</span>
        </div>
        <div className="chip-list">
          {numbers.map((number) => (
            <span key={number} className={`chip${currentResult === number ? ' chip--winner' : ''}`}>{number}</span>
          ))}
          {numbers.length === 0 && <span className="empty-state">Đã chọn đủ 35 số trong lượt này.</span>}
        </div>
      </section>

      <section className="numbers-panel">
        <div className="panel-heading"><h2>Lịch sử của bạn</h2><span>{history.length} kết quả</span></div>
        {history.length ? (
          <ol className="personal-history">
            {history.map((item, index) => (
              <li key={`${item.created_at}-${index}`}><strong>{item.selected_number}</strong><time>{new Date(item.created_at).toLocaleString('vi-VN')}</time></li>
            ))}
          </ol>
        ) : <p className="empty-state">Lịch sử quay sẽ xuất hiện sau khi bạn tham gia.</p>}
      </section>

      <section className="classroom-panel">
        <div className="panel-heading"><h2>Sơ đồ lớp học</h2><span>21 bàn / 35 số</span></div>
        {layout && <div className="classroom-grid">
          {layout.teams.map((team, teamIndex) => (
            <div key={team.name} className="classroom-team">
              <div className={`team-header team-header--${teamIndex + 1}`}>{team.name}</div>
              <div className="team-desks">
                {team.desks.map((desk, deskIndex) => (
                  <div key={`${team.name}-${deskIndex}`} className="desk-block">
                    {desk.seats.map((seatNumber) => (
                      <div key={`${team.name}-${deskIndex}-${seatNumber}`} className={`seat-box${currentResult === seatNumber ? ' seat-box--winner' : ''}`}>
                        {seatNumber}
                      </div>
                    ))}
                    {desk.seats.length === 0 && <span className="unassigned-seat">Chưa gán số</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>}
        <div className="classroom-meta">
          <span>{layout?.teacher || 'Bàn giáo viên'}</span>
          <span>{layout?.door || 'Cửa ra vào'}</span>
        </div>
      </section>
    </main>
  );
}

function AdminApp() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [admin, setAdmin] = useState<AdminIdentity | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [accessLogs, setAccessLogs] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [adminAccounts, setAdminAccounts] = useState<any[]>([]);
  const [adminRoleDrafts, setAdminRoleDrafts] = useState<Record<number, string>>({});
  const [passwordReset, setPasswordReset] = useState({ adminId: '', password: '' });
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [layoutDraft, setLayoutDraft] = useState<ClassroomLayout | null>(null);
  const [layoutVersion, setLayoutVersion] = useState('Sơ đồ lớp 11B7');
  const [layoutVersions, setLayoutVersions] = useState<LayoutVersion[]>([]);
  const [selectedLayoutVersion, setSelectedLayoutVersion] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [newAdmin, setNewAdmin] = useState({ username: '', fullName: '', password: '', role: 'viewer' });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const loadSession = async () => {
    const res = await fetch('/api/admin/session', { credentials: 'same-origin' });
    if (!res.ok) {
      setAdmin(null);
      return;
    }
    const data = await res.json();
    setAdmin(data.admin);
  };

  const loadDashboard = async () => {
    if (!admin) return;
    const userQuery = new URLSearchParams({ search: userSearch, from: dateFrom, to: dateTo });
    const canManage = admin.role === 'super_admin' || admin.role === 'admin';
    const [statsRes, usersRes, historyRes, accessRes, settingsRes, layoutRes, adminsRes, auditRes] = await Promise.all([
      fetch('/api/admin/stats', { credentials: 'same-origin' }),
      fetch(`/api/admin/users?${userQuery}`, { credentials: 'same-origin' }),
      fetch('/api/admin/history', { credentials: 'same-origin' }),
      fetch('/api/admin/access-logs', { credentials: 'same-origin' }),
      canManage ? fetch('/api/admin/settings', { credentials: 'same-origin' }) : Promise.resolve(null),
      canManage ? fetch('/api/admin/layout', { credentials: 'same-origin' }) : Promise.resolve(null),
      admin.role === 'super_admin' ? fetch('/api/admin/admins', { credentials: 'same-origin' }) : Promise.resolve(null),
      fetch('/api/admin/audit', { credentials: 'same-origin' }),
    ]);
    if (statsRes.ok) setStats(await statsRes.json());
    if (usersRes.ok) setUsers((await usersRes.json()).rows || []);
    if (historyRes.ok) setHistory((await historyRes.json()).rows || []);
    if (accessRes.ok) setAccessLogs((await accessRes.json()).rows || []);
    if (settingsRes?.ok) {
      const data = await settingsRes.json();
      setSettings(Object.fromEntries(data.settings.map((setting: { key: string; value: string }) => [setting.key, setting.value])));
    }
    if (layoutRes?.ok) {
      const data = await layoutRes.json();
      const activeLayout = data.layouts.find((item: LayoutVersion) => item.is_default);
      setLayoutVersions(data.layouts);
      if (activeLayout) {
        setLayoutDraft(activeLayout.layout);
        setLayoutVersion(activeLayout.version_name);
      }
    }
    if (adminsRes?.ok) setAdminAccounts((await adminsRes.json()).rows || []);
    if (auditRes.ok) setAuditLogs((await auditRes.json()).rows || []);
  };

  useEffect(() => {
    void loadSession();
  }, []);

  useEffect(() => {
    if (admin) void loadDashboard();
  }, [admin, userSearch, dateFrom, dateTo]);

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || 'Đăng nhập thất bại.');
      return;
    }
    setAdmin(data.admin);
    setUsername('');
    setPassword('');
  };

  const resetRound = async () => {
    if (!window.confirm('Đặt lại toàn bộ kết quả và mở lại 35 số?')) return;
    const res = await fetch('/api/admin/spin/reset', { method: 'POST', credentials: 'same-origin' });
    if (res.ok) {
      setNotice('Đã đặt lại lượt quay.');
      void loadDashboard();
    } else {
      setNotice((await res.json()).error || 'Không thể đặt lại lượt quay.');
    }
  };

  const unlockIp = async (ip: string) => {
    const res = await fetch(`/api/admin/ips/${encodeURIComponent(ip)}/unlock`, { method: 'POST', credentials: 'same-origin' });
    if (res.ok) {
      setNotice(`Đã mở khóa IP ${ip}; số trúng của IP được trả về danh sách còn lại.`);
      void loadDashboard();
    } else {
      setNotice((await res.json()).error || 'Không thể mở khóa IP.');
    }
  };

  const blockIp = async (ip: string) => {
    const res = await fetch(`/api/admin/ips/${encodeURIComponent(ip)}/block`, { method: 'POST', credentials: 'same-origin' });
    setNotice(res.ok ? `Đã khóa IP ${ip}.` : (await res.json()).error || 'Không thể khóa IP.');
    if (res.ok) void loadDashboard();
  };

  const resetUser = async (id: number) => {
    const res = await fetch(`/api/admin/users/${id}/reset`, { method: 'POST', credentials: 'same-origin' });
    setNotice(res.ok ? 'Đã đặt lại lượt của người dùng.' : (await res.json()).error || 'Không thể đặt lại lượt.');
    if (res.ok) void loadDashboard();
  };

  const saveSetting = async (key: string) => {
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ key, value: settings[key] || '' }),
    });
    setNotice(res.ok ? 'Đã lưu cấu hình.' : (await res.json()).error || 'Không thể lưu cấu hình.');
  };

  const updateDeskSeats = (teamIndex: number, deskIndex: number, value: string) => {
    setLayoutDraft((previous) => {
      if (!previous) return previous;
      const seats = value.trim() ? value.split(/[\s,;]+/).filter(Boolean).map(Number) : [];
      return {
        ...previous,
        teams: previous.teams.map((team, currentTeam) => currentTeam !== teamIndex ? team : {
          ...team,
          desks: team.desks.map((desk, currentDesk) => currentDesk === deskIndex ? { seats } : desk),
        }),
      };
    });
  };

  const moveDesk = (teamIndex: number, deskIndex: number, offset: number) => {
    setLayoutDraft((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        teams: previous.teams.map((team, currentTeam) => {
          if (currentTeam !== teamIndex) return team;
          const destination = deskIndex + offset;
          if (destination < 0 || destination >= team.desks.length) return team;
          const desks = [...team.desks];
          [desks[deskIndex], desks[destination]] = [desks[destination], desks[deskIndex]];
          return { ...team, desks };
        }),
      };
    });
  };

  const addDesk = (teamIndex: number) => {
    setLayoutDraft((previous) => previous ? ({
      ...previous,
      teams: previous.teams.map((team, currentTeam) => currentTeam === teamIndex
        ? { ...team, desks: [...team.desks, { seats: [] }] }
        : team),
    }) : previous);
  };

  const removeDesk = (teamIndex: number, deskIndex: number) => {
    setLayoutDraft((previous) => previous ? ({
      ...previous,
      teams: previous.teams.map((team, currentTeam) => currentTeam === teamIndex
        ? { ...team, desks: team.desks.filter((_, currentDesk) => currentDesk !== deskIndex) }
        : team),
    }) : previous);
  };

  const restoreLayout = async () => {
    if (!selectedLayoutVersion) return;
    const res = await fetch(`/api/admin/layout/${selectedLayoutVersion}/restore`, {
      method: 'POST',
      credentials: 'same-origin',
    });
    const data = await res.json();
    setNotice(res.ok ? 'Đã khôi phục sơ đồ đã lưu.' : data.error || 'Không thể khôi phục sơ đồ.');
    if (res.ok) void loadDashboard();
  };

  const saveLayout = async () => {
    if (!layoutDraft) return;
    const res = await fetch('/api/admin/layout', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ layout: layoutDraft, versionName: layoutVersion }),
    });
    setNotice(res.ok ? 'Đã lưu phiên bản sơ đồ.' : (await res.json()).error || 'Sơ đồ chưa hợp lệ.');
    if (res.ok) void loadDashboard();
  };

  const createAdmin = async (event: React.FormEvent) => {
    event.preventDefault();
    const res = await fetch('/api/admin/admins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(newAdmin),
    });
    setNotice(res.ok ? 'Đã tạo tài khoản quản trị.' : (await res.json()).error || 'Không thể tạo tài khoản.');
    if (res.ok) {
      setNewAdmin({ username: '', fullName: '', password: '', role: 'viewer' });
      void loadDashboard();
    }
  };

  const toggleAdmin = async (id: number, isActive: boolean) => {
    const res = await fetch(`/api/admin/admins/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ isActive: !isActive }),
    });
    setNotice(res.ok ? 'Đã cập nhật trạng thái tài khoản.' : (await res.json()).error || 'Không thể cập nhật tài khoản.');
    if (res.ok) void loadDashboard();
  };

  const updateAdminRole = async (id: number) => {
    const role = adminRoleDrafts[id];
    if (!role) return;
    const res = await fetch(`/api/admin/admins/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ role }),
    });
    setNotice(res.ok ? 'Đã cập nhật vai trò.' : (await res.json()).error || 'Không thể cập nhật vai trò.');
    if (res.ok) void loadDashboard();
  };

  const resetAdminPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (passwordReset.password.length < 12) {
      setNotice('Mật khẩu mới cần tối thiểu 12 ký tự.');
      return;
    }
    const res = await fetch(`/api/admin/admins/${passwordReset.adminId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ password: passwordReset.password }),
    });
    setNotice(res.ok ? 'Đã đổi mật khẩu và thu hồi các phiên cũ.' : (await res.json()).error || 'Không thể đổi mật khẩu.');
    if (res.ok) setPasswordReset({ adminId: '', password: '' });
  };

  const deleteAdmin = async (id: number) => {
    if (!window.confirm('Xóa tài khoản quản trị này?')) return;
    const res = await fetch(`/api/admin/admins/${id}`, { method: 'DELETE', credentials: 'same-origin' });
    setNotice(res.ok ? 'Đã xóa tài khoản quản trị.' : (await res.json()).error || 'Không thể xóa tài khoản.');
    if (res.ok) void loadDashboard();
  };

  const logout = async () => {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
    setAdmin(null);
    setStats(null);
  };

  if (!admin) {
    return (
      <main className="admin-shell">
        <section className="login-panel">
          <div className="login-brand">Lớp học 11B7</div>
          <h1>Đăng nhập quản trị</h1>
          <p>Chỉ admin được cấp quyền mới có thể quản lý hệ thống và lượt quay.</p>
          <form onSubmit={login} className="admin-form">
            <label>
              <span>Tên đăng nhập</span>
              <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="superadmin" />
            </label>
            <label>
              <span>Mật khẩu</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" />
            </label>
            {error && <div className="form-error">{error}</div>}
            <button type="submit" disabled={loading}>{loading ? 'Đang đăng nhập...' : 'Đăng nhập'}</button>
          </form>
        </section>
      </main>
    );
  }

  const canManageSpins = admin.role === 'super_admin' || admin.role === 'admin';
  const canManageIps = canManageSpins || admin.role === 'moderator';

  return (
    <main
      className="admin-shell admin-shell--logged"
      style={{
        '--primary': settings.accent_color || '#2457cc',
        fontFamily: `${settings.font_family || 'Manrope'}, sans-serif`,
      } as React.CSSProperties}
    >
      <aside className="admin-sidebar">
        <div className="brand-mark admin-brand">
          {settings.site_logo ? <img className="admin-logo" src={settings.site_logo} alt="" /> : <>11<span>B7</span></>}
        </div>
        <h2>Dashboard</h2>
        <nav>
          <a href="#overview">Tổng quan</a>
          <a href="#users">Người dùng</a>
          <a href="#access">Truy cập</a>
          <a href="#history">Lịch sử quay</a>
          <a href="#layout">Sơ đồ lớp</a>
          <a href="#admins">Quản trị viên</a>
          <a href="#audit">Nhật ký</a>
          <a href="#settings">Cấu hình</a>
        </nav>
        <button type="button" className="logout-button" onClick={logout}>Đăng xuất</button>
      </aside>

      <section className="admin-content">
        <header className="admin-topbar">
          <div>
            <p className="eyebrow">ADMIN CONTROL</p>
            <h1>Quản trị hệ thống</h1>
          </div>
          <div className="admin-user">{admin.fullName} / {admin.username}</div>
        </header>

        {notice && <div className="status-bar admin-notice" role="status">{notice}</div>}
        <div id="overview" className="stat-grid">
          <div className="stat-card"><span>Tổng lượt truy cập</span><strong>{stats?.totals?.access ?? 0}</strong></div>
          <div className="stat-card"><span>Tổng người nhập tên</span><strong>{stats?.totals?.users ?? 0}</strong></div>
          <div className="stat-card"><span>Đã quay</span><strong>{stats?.totals?.spun ?? 0}</strong></div>
          <div className="stat-card"><span>Chưa quay</span><strong>{stats?.totals?.pending ?? 0}</strong></div>
          <div className="stat-card"><span>Số trúng</span><strong>{stats?.totals?.successfulSpins ?? 0}</strong></div>
          <div className="stat-card"><span>IP bị khóa</span><strong>{stats?.totals?.lockedIps ?? 0}</strong></div>
          <div className="stat-card"><span>Số còn lại</span><strong>{stats?.totals?.remaining ?? 0}</strong></div>
          <button type="button" className="widget-button" onClick={resetRound}>Đặt lại lượt quay</button>
        </div>

        <section className="table-panel chart-grid">
          <div>
            <h2>Truy cập theo ngày</h2>
            {(stats?.dailySummary || []).map((item: any) => {
              const max = Math.max(1, ...stats.dailySummary.map((entry: any) => entry.count));
              return <div className="chart-row" key={item.date}><span>{item.date}</span><div><i style={{ width: `${(item.count / max) * 100}%` }} /></div><strong>{item.count}</strong></div>;
            })}
          </div>
          <div>
            <h2>Kết quả quay</h2>
            <div className="chart-number-list">{(stats?.wheelSummary || []).map((item: any) => <span key={item.number}>{item.number}<b>{item.count}</b></span>)}</div>
          </div>
          <div>
            <h2>Hoạt động gần đây</h2>
            <ul className="activity-list">{(stats?.recentActivity || []).map((item: any, index: number) => <li key={`${item.action}-${index}`}><strong>{item.username || 'Hệ thống'}</strong><span>{item.action}</span><time>{new Date(item.created_at).toLocaleString('vi-VN')}</time></li>)}</ul>
          </div>
        </section>

        <section id="users" className="table-panel">
          <div className="section-heading">
            <h2>Người dùng</h2>
            <a href="/api/admin/export/csv" className="secondary-link" target="_blank" rel="noreferrer">Xuất CSV</a>
          </div>
          <div className="filter-row">
            <label>Tìm tên<input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Tìm theo họ tên" /></label>
            <label>Từ ngày<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
            <label>Đến ngày<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
          </div>
          <table>
            <thead>
              <tr>
                <th>Họ tên</th>
                <th>IP</th>
                <th>Truy cập</th>
                <th>Thiết bị</th>
                <th>Đã quay</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.name}</td>
                  <td>{user.ip || 'N/A'}</td>
                  <td>{user.access_count ?? 0}</td>
                  <td>{[user.browser, user.device].filter(Boolean).join(' / ') || 'Không rõ'}</td>
                  <td>{user.completed_spin ? 'Có' : 'Chưa'}</td>
                  <td className="action-cell">
                    {canManageSpins && <button type="button" className="mini-button" onClick={() => void resetUser(user.id)}>Reset lượt</button>}
                    {canManageIps && <>
                    <button type="button" className="mini-button mini-button--quiet" onClick={() => void unlockIp(user.ip)}>Mở khóa IP</button>
                    <button type="button" className="mini-button mini-button--danger" onClick={() => void blockIp(user.ip)}>Khóa IP</button>
                  </>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section id="access" className="table-panel">
          <div className="section-heading"><h2>Lịch sử truy cập</h2><span>{accessLogs.length} bản ghi gần nhất</span></div>
          <table><thead><tr><th>Họ tên</th><th>IP</th><th>Thiết bị</th><th>Trình duyệt</th><th>Hệ điều hành</th><th>Truy cập</th><th>Kết thúc phiên</th><th>Quay</th></tr></thead>
            <tbody>{accessLogs.map((row) => <tr key={row.id}><td>{row.name}</td><td>{row.ip}</td><td>{row.device}</td><td>{row.browser}</td><td>{row.os}</td><td>{new Date(row.visited_at).toLocaleString('vi-VN')}</td><td>{row.ended_at ? new Date(row.ended_at).toLocaleString('vi-VN') : 'Đang hoạt động'}</td><td>{row.completed_spin ? row.selected_number : 'Chưa'}</td></tr>)}</tbody>
          </table>
        </section>

        <section id="history" className="table-panel">
          <div className="section-heading">
            <h2>Lịch sử quay</h2>
          </div>
          <table>
            <thead>
              <tr>
                <th>Họ tên</th>
                <th>Số</th>
                <th>IP</th>
                <th>Thời gian</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.selected_number}</td>
                  <td>{row.ip}</td>
                  <td>{new Date(row.created_at).toLocaleString('vi-VN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {layoutDraft && (admin.role === 'super_admin' || admin.role === 'admin') && <section id="layout" className="table-panel">
          <div className="section-heading"><div><h2>Quản lý sơ đồ lớp</h2><p>Sơ đồ mặc định có 21 bàn theo thứ tự Tổ 4, Tổ 3, Tổ 2, Tổ 1. Hãy dùng ảnh lớp để gán đủ số 1-35.</p></div><button type="button" className="secondary-button" onClick={() => void saveLayout()}>Lưu phiên bản</button></div>
          <div className="layout-meta-fields">
            <label>Bàn giáo viên<input value={layoutDraft.teacher} onChange={(event) => setLayoutDraft({ ...layoutDraft, teacher: event.target.value })} /></label>
            <label>Cửa ra vào<input value={layoutDraft.door} onChange={(event) => setLayoutDraft({ ...layoutDraft, door: event.target.value })} /></label>
          </div>
          <label className="version-field">Tên phiên bản<input value={layoutVersion} onChange={(event) => setLayoutVersion(event.target.value)} /></label>
          <div className="layout-restore-row">
            <label>Phiên bản đã lưu<select value={selectedLayoutVersion} onChange={(event) => setSelectedLayoutVersion(event.target.value)}><option value="">Chọn phiên bản</option>{layoutVersions.map((version) => <option key={version.id} value={version.id}>{version.version_name} — {new Date(version.created_at).toLocaleString('vi-VN')}</option>)}</select></label>
            <button type="button" className="secondary-button" disabled={!selectedLayoutVersion} onClick={() => void restoreLayout()}>Khôi phục phiên bản</button>
          </div>
          <div className="layout-editor">
            {layoutDraft.teams.map((team, teamIndex) => <div className="layout-team" key={teamIndex}>
              <div className="layout-team-heading"><label>Tên tổ<input value={team.name} onChange={(event) => setLayoutDraft({ ...layoutDraft, teams: layoutDraft.teams.map((current, index) => index === teamIndex ? { ...current, name: event.target.value } : current) })} /></label><button type="button" className="mini-button" onClick={() => addDesk(teamIndex)}>Thêm bàn</button></div>
              {team.desks.map((desk, deskIndex) => <div className="layout-desk" key={`${teamIndex}-${deskIndex}`}><span>Bàn {deskIndex + 1}</span><input aria-label={`${team.name}, bàn ${deskIndex + 1}, số ghế`} value={desk.seats.join(', ')} onChange={(event) => updateDeskSeats(teamIndex, deskIndex, event.target.value)} placeholder="Ví dụ: 1, 2" /><div><button type="button" className="icon-button" aria-label="Di chuyển bàn lên" title="Di chuyển lên" onClick={() => moveDesk(teamIndex, deskIndex, -1)} disabled={deskIndex === 0}>↑</button><button type="button" className="icon-button" aria-label="Di chuyển bàn xuống" title="Di chuyển xuống" onClick={() => moveDesk(teamIndex, deskIndex, 1)} disabled={deskIndex === team.desks.length - 1}>↓</button><button type="button" className="icon-button remove-desk" aria-label="Xóa bàn" title="Xóa bàn" onClick={() => removeDesk(teamIndex, deskIndex)} disabled={team.desks.length === 1}>×</button></div></div>)}
            </div>)}
          </div>
          <p className="layout-help">Số bàn hiện tại: {layoutDraft.teams.reduce((total, team) => total + team.desks.length, 0)} / 21. Mỗi bàn phải có ít nhất một số ghế và toàn bộ số 1-35 chỉ xuất hiện một lần trước khi lưu.</p>
        </section>}

        {admin.role === 'super_admin' && <section id="admins" className="table-panel">
          <div className="section-heading"><h2>Tài khoản quản trị</h2></div>
          <table><thead><tr><th>Tên đăng nhập</th><th>Họ tên</th><th>Vai trò</th><th>Trạng thái</th><th>Hành động</th></tr></thead>
            <tbody>{adminAccounts.map((account) => <tr key={account.id}><td>{account.username}</td><td>{account.full_name}</td><td><select value={adminRoleDrafts[account.id] || account.role} onChange={(event) => setAdminRoleDrafts({ ...adminRoleDrafts, [account.id]: event.target.value })}><option value="super_admin">Super Admin</option><option value="admin">Admin</option><option value="moderator">Moderator</option><option value="viewer">Viewer</option></select><button type="button" className="mini-button" disabled={account.id === admin.id} onClick={() => void updateAdminRole(account.id)}>Lưu vai trò</button></td><td>{account.is_active ? 'Hoạt động' : 'Đã khóa'}</td><td className="action-cell"><button type="button" className="mini-button" disabled={account.id === admin.id} onClick={() => void toggleAdmin(account.id, Boolean(account.is_active))}>{account.is_active ? 'Khóa' : 'Mở khóa'}</button><button type="button" className="mini-button mini-button--danger" disabled={account.id === admin.id} onClick={() => void deleteAdmin(account.id)}>Xóa</button></td></tr>)}</tbody>
          </table>
          <form className="admin-create-form" onSubmit={createAdmin}>
            <label>Tên đăng nhập<input required minLength={3} value={newAdmin.username} onChange={(event) => setNewAdmin({ ...newAdmin, username: event.target.value })} /></label>
            <label>Họ tên<input required value={newAdmin.fullName} onChange={(event) => setNewAdmin({ ...newAdmin, fullName: event.target.value })} /></label>
            <label>Mật khẩu (tối thiểu 12 ký tự)<input required minLength={12} type="password" value={newAdmin.password} onChange={(event) => setNewAdmin({ ...newAdmin, password: event.target.value })} /></label>
            <label>Vai trò<select value={newAdmin.role} onChange={(event) => setNewAdmin({ ...newAdmin, role: event.target.value })}><option value="admin">Admin</option><option value="moderator">Moderator</option><option value="viewer">Viewer</option></select></label>
            <button type="submit" className="secondary-button">Tạo tài khoản</button>
          </form>
          <form className="admin-create-form password-reset-form" onSubmit={resetAdminPassword}>
            <label>Tài khoản<select required value={passwordReset.adminId} onChange={(event) => setPasswordReset({ ...passwordReset, adminId: event.target.value })}><option value="">Chọn tài khoản</option>{adminAccounts.filter((account) => account.id !== admin.id).map((account) => <option key={account.id} value={account.id}>{account.username}</option>)}</select></label>
            <label>Mật khẩu mới (tối thiểu 12 ký tự)<input required minLength={12} type="password" value={passwordReset.password} onChange={(event) => setPasswordReset({ ...passwordReset, password: event.target.value })} /></label>
            <button type="submit" className="secondary-button">Đổi mật khẩu</button>
          </form>
        </section>}

        <section id="audit" className="table-panel">
          <div className="section-heading"><h2>Nhật ký quản trị</h2></div>
          <table><thead><tr><th>Quản trị viên</th><th>Thao tác</th><th>Chi tiết</th><th>Thời gian</th></tr></thead>
            <tbody>{auditLogs.map((row) => <tr key={row.id}><td>{row.username || 'Tài khoản đã xóa'}</td><td>{row.action}</td><td>{row.details}</td><td>{new Date(row.created_at).toLocaleString('vi-VN')}</td></tr>)}</tbody>
          </table>
        </section>

        {(admin.role === 'super_admin' || admin.role === 'admin') && <section id="settings" className="table-panel">
          <div className="section-heading">
            <h2>Cấu hình hệ thống</h2>
          </div>
          <div className="config-list">
            <label><span>Tên website</span><input value={settings.site_name || ''} onChange={(event) => setSettings({ ...settings, site_name: event.target.value })} /><button type="button" className="mini-button" onClick={() => void saveSetting('site_name')}>Lưu</button></label>
            <label><span>Logo (đường dẫn nội bộ)</span><input value={settings.site_logo || ''} onChange={(event) => setSettings({ ...settings, site_logo: event.target.value })} placeholder="/logo.png" /><button type="button" className="mini-button" onClick={() => void saveSetting('site_logo')}>Lưu</button></label>
            <label><span>Màu chủ đạo</span><input type="color" value={settings.accent_color || '#2457cc'} onChange={(event) => setSettings({ ...settings, accent_color: event.target.value })} /><button type="button" className="mini-button" onClick={() => void saveSetting('accent_color')}>Lưu</button></label>
            <label><span>Font chữ</span><select value={settings.font_family || 'Manrope'} onChange={(event) => setSettings({ ...settings, font_family: event.target.value })}><option>Manrope</option><option>Arial</option><option>Verdana</option><option>Tahoma</option><option>system-ui</option></select><button type="button" className="mini-button" onClick={() => void saveSetting('font_family')}>Lưu</button></label>
            <label><span>Thông báo trên trang chính</span><input maxLength={300} value={settings.public_notice || ''} onChange={(event) => setSettings({ ...settings, public_notice: event.target.value })} /><button type="button" className="mini-button" onClick={() => void saveSetting('public_notice')}>Lưu</button></label>
            {admin.role === 'super_admin' && <label><span>Giới hạn lượt quay</span><select value={settings.spin_limit_mode || 'ip'} onChange={(event) => setSettings({ ...settings, spin_limit_mode: event.target.value })}><option value="ip">Theo IP</option><option value="account">Theo tài khoản</option></select><button type="button" className="mini-button" onClick={() => void saveSetting('spin_limit_mode')}>Lưu</button></label>}
            <label><span>Âm thanh vòng quay</span><select value={settings.wheel_sound_enabled || 'true'} onChange={(event) => setSettings({ ...settings, wheel_sound_enabled: event.target.value })}><option value="true">Bật</option><option value="false">Tắt</option></select><button type="button" className="mini-button" onClick={() => void saveSetting('wheel_sound_enabled')}>Lưu</button></label>
            <label><span>Thời lượng animation (ms)</span><input type="number" min="1500" max="10000" step="100" value={settings.wheel_duration_ms || '4700'} onChange={(event) => setSettings({ ...settings, wheel_duration_ms: event.target.value })} /><button type="button" className="mini-button" onClick={() => void saveSetting('wheel_duration_ms')}>Lưu</button></label>
            <label><span>Chế độ bảo trì</span><select value={settings.maintenance_mode || 'false'} onChange={(event) => setSettings({ ...settings, maintenance_mode: event.target.value })}><option value="false">Tắt</option><option value="true">Bật</option></select><button type="button" className="mini-button" onClick={() => void saveSetting('maintenance_mode')}>Lưu</button></label>
            <label><span>Thời gian lưu lịch sử (ngày)</span><input type="number" min="1" max="3650" value={settings.history_retention_days || '365'} onChange={(event) => setSettings({ ...settings, history_retention_days: event.target.value })} /><button type="button" className="mini-button" onClick={() => void saveSetting('history_retention_days')}>Lưu</button></label>
            {admin.role === 'super_admin' && <label><span>Số lần đăng nhập sai tối đa</span><input type="number" min="3" max="20" value={settings.max_failed_logins || '5'} onChange={(event) => setSettings({ ...settings, max_failed_logins: event.target.value })} /><button type="button" className="mini-button" onClick={() => void saveSetting('max_failed_logins')}>Lưu</button></label>}
          </div>
          {admin.role === 'super_admin' && <a className="secondary-link backup-link" href="/api/admin/database/backup">Tải bản sao lưu database</a>}
        </section>}
      </section>
    </main>
  );
}

export default function App() {
  const currentPath = typeof window === 'undefined' ? '/' : window.location.pathname;
  return currentPath.startsWith('/admin') ? <AdminApp /> : <PublicApp />;
}
