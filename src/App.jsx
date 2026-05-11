import { useState, useEffect, useRef, useCallback } from 'react';
import { isSupabaseConfigured, dbGetTeams, dbGetPlayers, dbGetMatches,
  dbUpsertTeam, dbUpsertPlayer, dbDeletePlayer, dbInsertMatches, dbDeleteAllMatches,
  dbResetMatchResults, dbUpsertMatch, subscribeToChanges } from './supabase.js';

const STORAGE_KEY = 'tabpinpon_v5';
const ADMIN_PW = 'Admin2026Tab2026';
const RANKS = ['A', 'B', 'C', 'D'];
const RANK_COLORS = { A: 'bg-red-100 text-red-700', B: 'bg-blue-100 text-blue-700', C: 'bg-green-100 text-green-700', D: 'bg-purple-100 text-purple-700' };

const DEFAULT_TEAMS = [
  { id: 'fb', name: 'Fenerbahce', color: '#003399', logo: '', players: [
    { id: 'fb1', name: 'Senol', photo: '', rank: 'A' },
    { id: 'fb2', name: 'Fatih', photo: '', rank: 'A' },
    { id: 'fb3', name: 'Samet', photo: '', rank: 'B' },
    { id: 'fb4', name: 'Gokhan', photo: '', rank: 'B' },
    { id: 'fb5', name: 'Can', photo: '', rank: 'B' },
    { id: 'fb6', name: 'Suleyman', photo: '', rank: 'C' },
    { id: 'fb7', name: 'Burak', photo: '', rank: 'C' },
  ]},
  { id: 'gs', name: 'Galatasaray', color: '#CC0000', logo: '', players: [
    { id: 'gs1', name: 'Guven', photo: '', rank: 'A' },
    { id: 'gs2', name: 'Emre Y.', photo: '', rank: 'A' },
    { id: 'gs3', name: 'Ugur', photo: '', rank: 'B' },
    { id: 'gs4', name: 'Erdinc', photo: '', rank: 'B' },
    { id: 'gs5', name: 'Emre M.', photo: '', rank: 'B' },
    { id: 'gs6', name: 'Cagatay', photo: '', rank: 'C' },
    { id: 'gs7', name: 'Mehmet', photo: '', rank: 'C' },
  ]},
  { id: 'bjk', name: 'Besiktas', color: '#000000', logo: '', players: [
    { id: 'bjk1', name: 'Erhan', photo: '', rank: 'A' },
    { id: 'bjk2', name: 'Cemal', photo: '', rank: 'A' },
    { id: 'bjk3', name: 'Okan', photo: '', rank: 'B' },
    { id: 'bjk4', name: 'Mert', photo: '', rank: 'B' },
    { id: 'bjk5', name: 'Oner', photo: '', rank: 'B' },
    { id: 'bjk6', name: 'Mustafa', photo: '', rank: 'C' },
    { id: 'bjk7', name: 'Kadir', photo: '', rank: 'C' },
    { id: 'bjk8', name: 'Salih', photo: '', rank: 'C' },
  ]},
];

function genId() { return Math.random().toString(36).slice(2,9) + Date.now().toString(36); }

function generateFixtures(teams) {
  const byRank = {};
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const tA = teams[i], tB = teams[j];
      for (const pA of tA.players) {
        for (const pB of tB.players) {
          if (pA.rank === pB.rank) {
            const r = pA.rank;
            if (!byRank[r]) byRank[r] = [];
            byRank[r].push({ id: genId(), teamAId: tA.id, teamBId: tB.id,
              playerAId: pA.id, playerBId: pB.id, sets: [], setA: 0, setB: 0,
              pointsA: 0, pointsB: 0, played: false, matchDate: null });
          }
        }
      }
    }
  }
  const result = [];
  for (const rank of RANKS) {
    if (!byRank[rank]) continue;
    const ms = byRank[rank];
    for (let i = ms.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ms[i], ms[j]] = [ms[j], ms[i]];
    }
    const placed = [], remaining = [...ms];
    let attempts = 0;
    while (remaining.length > 0 && attempts < remaining.length * 10) {
      const m = remaining[0];
      const lastTwo = placed.slice(-2);
      const busy = lastTwo.some(pm =>
        pm.playerAId === m.playerAId || pm.playerBId === m.playerAId ||
        pm.playerAId === m.playerBId || pm.playerBId === m.playerBId
      );
      if (!busy) { placed.push(remaining.shift()); attempts = 0; }
      else { remaining.push(remaining.shift()); attempts++; }
    }
    placed.push(...remaining);
    result.push(...placed);
  }
  return result;
}

function loadLocal() {
  try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) return JSON.parse(raw); } catch {}
  return { teams: DEFAULT_TEAMS, matches: [] };
}
function saveLocal(teams, matches) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ teams, matches })); } catch {}
}
function mapDbMatch(m) {
  return { id: m.id, teamAId: m.team_a_id, teamBId: m.team_b_id, playerAId: m.player_a_id,
    playerBId: m.player_b_id, sets: m.sets || [], setA: m.sets_a || 0, setB: m.sets_b || 0,
    pointsA: m.points_a || 0, pointsB: m.points_b || 0, played: m.played || false, matchDate: m.match_date || null };
}
function compressImage(file, maxW = 400) {
  return new Promise(res => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, maxW / Math.max(img.width, img.height));
        const w = Math.round(img.width * ratio), h = Math.round(img.height * ratio);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        res(c.toDataURL('image/jpeg', 0.85));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d + 'T12:00:00');
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('tr-TR', { day:'2-digit', month:'2-digit', year:'numeric' });
}
// Avatar helper - square crop to circle
function Avatar({ src, name, color, size = 8 }) {
  const sClass = 'w-' + size + ' h-' + size;
  if (src) return <img src={src} className={sClass + ' rounded-full object-cover object-center flex-shrink-0'} style={{aspectRatio:'1/1'}} />;
  return <div className={sClass + ' rounded-full flex items-center justify-center text-white font-bold flex-shrink-0 text-sm'} style={{background: color || '#999', aspectRatio:'1/1'}}>{(name||'?')[0].toUpperCase()}</div>;
}

export default function App() {
  const [teams, setTeams] = useState([]);
  const [matches, setMatches] = useState([]);
  const [tab, setTab] = useState('standings');
  const [isAdmin, setIsAdmin] = useState(false);
  const [pw, setPw] = useState('');
  const [pwError, setPwError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [flashMsg, setFlashMsg] = useState('');
  const [editMatch, setEditMatch] = useState(null);
  const [editDateMatch, setEditDateMatch] = useState(null);
  const [editPlayer, setEditPlayer] = useState(null);
  const [editTeam, setEditTeam] = useState(null);
  const [addPlayerTeamId, setAddPlayerTeamId] = useState(null);
  const [filterRank, setFilterRank] = useState('all');
  const [filterTeam, setFilterTeam] = useState('all');
  const [filterDate, setFilterDate] = useState('');

  function flash(msg) { setFlashMsg(msg); setTimeout(() => setFlashMsg(''), 3000); }

  const loadFromSupabase = useCallback(async () => {
    try {
      const [teamsData, playersData, matchesData] = await Promise.all([dbGetTeams(), dbGetPlayers(), dbGetMatches()]);
      if (!teamsData) return false;
      const mergedTeams = teamsData.map(t => ({
        id: t.id, name: t.name, color: t.color, logo: t.logo || '',
        players: playersData.filter(p => p.team_id === t.id).map(p => ({ id: p.id, name: p.name, photo: p.photo || '', rank: p.rank || 'B' }))
      }));
      const mergedMatches = matchesData.map(mapDbMatch);
      setTeams(mergedTeams); setMatches(mergedMatches);
      saveLocal(mergedTeams, mergedMatches);
      return true;
    } catch (e) { console.error('Supabase load error:', e); return false; }
  }, []);

  useEffect(() => {
    async function init() {
      if (isSupabaseConfigured) {
        const ok = await loadFromSupabase();
        if (!ok) { const local = loadLocal(); setTeams(local.teams); setMatches(local.matches); }
      } else { const local = loadLocal(); setTeams(local.teams); setMatches(local.matches); }
      setLoading(false);
    }
    init();
  }, [loadFromSupabase]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const unsub = subscribeToChanges(() => loadFromSupabase(), () => loadFromSupabase(), () => loadFromSupabase());
    return unsub;
  }, [loadFromSupabase]);

  useEffect(() => {
    if (!isSupabaseConfigured && teams.length > 0) saveLocal(teams, matches);
  }, [teams, matches]);

  function login() {
    if (pw === ADMIN_PW) { setIsAdmin(true); setPwError(false); setPw(''); }
    else { setPwError(true); }
  }

  function calcStandings() {
    return teams.map(t => {
      let W=0,L=0,SA=0,SB=0,PA=0,PB=0;
      const tm = matches.filter(m => m.played && (m.teamAId===t.id||m.teamBId===t.id));
      tm.forEach(m => {
        const isA=m.teamAId===t.id;
        const ws=isA?m.setA:m.setB, ls=isA?m.setB:m.setA;
        SA+=ws; SB+=ls;
        const wp=isA?m.pointsA:m.pointsB, lp=isA?m.pointsB:m.pointsA;
        PA+=wp; PB+=lp;
        if(ws>ls) W++; else L++;
      });
      return { ...t, played:tm.length, W, L, SA, SB, PA, PB, pts:W*3 };
    }).sort((a,b)=>b.pts-a.pts||(b.SA-b.SB)-(a.SA-a.SB)||(b.PA-b.PB)-(a.PA-a.PB));
  }

  function calcPlayerStats() {
    return teams.flatMap(t => t.players.map(p => {
      let W=0,L=0,SA=0,SB=0,PA=0,PB=0;
      const pm = matches.filter(m => m.played && (m.playerAId===p.id||m.playerBId===p.id));
      pm.forEach(m => {
        const isA=m.playerAId===p.id;
        const ws=isA?m.setA:m.setB, ls=isA?m.setB:m.setA;
        SA+=ws; SB+=ls;
        const wp=isA?m.pointsA:m.pointsB, lp=isA?m.pointsB:m.pointsA;
        PA+=wp; PB+=lp;
        if(ws>ls) W++; else L++;
      });
      return { ...p, teamId:t.id, teamName:t.name, teamColor:t.color, played:pm.length, W, L, SA, SB, PA, PB, pts:W*3 };
    })).sort((a,b)=>b.pts-a.pts);
  }

  async function handleGenerateFixtures() {
    if (!confirm('Mevcut fikstur silinip yeniden olusturulacak. Onayliyor musunuz?')) return;
    const newMatches = generateFixtures(teams);
    if (isSupabaseConfigured) {
      try { await dbDeleteAllMatches(); await dbInsertMatches(newMatches); }
      catch(e) { flash('Hata: ' + e.message); return; }
      await loadFromSupabase();
    } else { setMatches(newMatches); }
    flash('Fikstur olusturuldu! ' + newMatches.length + ' mac.');
  }

  async function handleResetAll() {
    if (!confirm('Tum mac sonuclari sifirlanacak. Onayliyor musunuz?')) return;
    if (isSupabaseConfigured) {
      try { await dbResetMatchResults(); } catch(e) { flash('Hata: ' + e.message); return; }
      await loadFromSupabase();
    } else {
      setMatches(prev => prev.map(m => ({...m, sets:[], setA:0, setB:0, pointsA:0, pointsB:0, played:false})));
    }
    flash('Tum sonuclar sifirlanoi.');
  }

  async function handleSaveMatch(matchId, sets, matchDate) {
    const sA = sets.filter(s=>+s.a>+s.b).length, sB = sets.filter(s=>+s.b>+s.a).length;
    const pA = sets.reduce((s,x)=>s+(+x.a||0),0), pB = sets.reduce((s,x)=>s+(+x.b||0),0);
    const updated = { ...matches.find(m=>m.id===matchId), sets, setA:sA, setB:sB, pointsA:pA, pointsB:pB, played:true, matchDate:matchDate||null };
    if (isSupabaseConfigured) {
      try { await dbUpsertMatch(updated); } catch(e) { flash('Hata: ' + e.message); return; }
      setMatches(prev => prev.map(m => m.id===matchId ? updated : m));
    } else {
      setMatches(prev => prev.map(m => m.id===matchId ? updated : m));
    }
    setEditMatch(null); flash('Mac kaydedildi!');
  }

  async function handleSaveDate(matchId, matchDate) {
    const updated = { ...matches.find(m=>m.id===matchId), matchDate: matchDate||null };
    if (isSupabaseConfigured) {
      try { await dbUpsertMatch(updated); } catch(e) { flash('Hata: ' + e.message); return; }
      setMatches(prev => prev.map(m => m.id===matchId ? updated : m));
    } else {
      setMatches(prev => prev.map(m => m.id===matchId ? updated : m));
    }
    setEditDateMatch(null); flash('Tarih kaydedildi!');
  }

  async function handleSavePlayer(player) {
    const updTeams = teams.map(t => ({...t, players: t.players.map(p => p.id===player.id ? {...p,...player} : p)}));
    if (isSupabaseConfigured) {
      const t = updTeams.find(t => t.players.some(p=>p.id===player.id));
      try { await dbUpsertPlayer({...player, teamId:t?.id}); } catch(e) { flash('Hata: ' + e.message); return; }
      await loadFromSupabase();
    } else { setTeams(updTeams); }
    setEditPlayer(null); flash('Oyuncu guncellendi!');
  }

  async function handleAddPlayer(teamId, playerData) {
    const newP = { id: genId(), name: playerData.name, rank: playerData.rank||'B', photo: playerData.photo||'' };
    if (isSupabaseConfigured) {
      try { await dbUpsertPlayer({...newP, teamId}); } catch(e) { flash('Hata: ' + e.message); return; }
      await loadFromSupabase();
    } else {
      setTeams(prev => prev.map(t => t.id===teamId ? {...t, players:[...t.players,newP]} : t));
    }
    setAddPlayerTeamId(null); flash('Oyuncu eklendi!');
  }

  async function handleRemovePlayer(playerId) {
    if (!confirm('Bu oyuncu kadrodan cikarilacak. Onayliyor musunuz?')) return;
    if (isSupabaseConfigured) {
      try { await dbDeletePlayer(playerId); } catch(e) { flash('Hata: ' + e.message); return; }
      await loadFromSupabase();
    } else {
      setTeams(prev => prev.map(t => ({...t, players:t.players.filter(p=>p.id!==playerId)})));
    }
    flash('Oyuncu cikarildi!');
  }

  async function handleSaveTeam(team) {
    if (isSupabaseConfigured) {
      try { await dbUpsertTeam(team); } catch(e) { flash('Hata: ' + e.message); return; }
      await loadFromSupabase();
    } else {
      setTeams(prev => prev.map(t => t.id===team.id ? {...t,...team} : t));
    }
    setEditTeam(null); flash('Takim guncellendi!');
  }

  const standings = calcStandings();
  const playerStats = calcPlayerStats();

  if (loading) return (
    <div className="min-h-screen bg-amber-50 flex items-center justify-center">
      <div className="text-center"><div className="text-4xl mb-3">🏓</div><div className="text-gray-500">Yukleniyor...</div></div>
    </div>
  );

  return (
    <div className="min-h-screen bg-amber-50 font-sans">
      <header className="bg-white border-b border-amber-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🏓</span>
            <div>
              <div className="font-bold text-gray-800 text-lg leading-tight">TabMuhasebe</div>
              <div className="text-xs text-amber-600 flex items-center gap-1">
                Pinpon Turnuvasi
                {isSupabaseConfigured ? <span className="bg-green-100 text-green-600 px-1 rounded text-xs">● Canli</span> : <span className="bg-yellow-100 text-yellow-600 px-1 rounded text-xs">○ Offline</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin ? (
              <span onClick={() => setIsAdmin(false)} className="text-xs bg-green-100 text-green-700 px-3 py-1 rounded-full font-medium cursor-pointer hover:bg-green-200">✓ Admin</span>
            ) : (
              <div className="flex gap-1">
                <input value={pw} onChange={e=>{setPw(e.target.value);setPwError(false);}} onKeyDown={e=>e.key==='Enter'&&login()} type="password"
                  placeholder="Sifre" className={"border rounded px-2 py-1 text-sm w-28 " + (pwError?'border-red-400':'border-gray-300')} />
                <button onClick={login} className="bg-amber-500 text-white px-3 py-1 rounded text-sm hover:bg-amber-600">Giris</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {flashMsg && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white px-4 py-2 rounded-full shadow-lg text-sm font-medium">{flashMsg}</div>}

      <div className="max-w-5xl mx-auto px-4 pt-4">
        <div className="flex gap-1 border-b border-amber-200 overflow-x-auto">
          {[['standings','🏆 Puan Durumu'],['matches','⚔️ Maclar'],['players','👤 Oyuncular'],['squads','👥 Kadrolar']].map(([k,v]) => (
            <button key={k} onClick={()=>setTab(k)}
              className={"px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap " + (tab===k?'border-amber-500 text-amber-600':'border-transparent text-gray-500 hover:text-gray-700')}>{v}</button>
          ))}
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {tab==='standings' && <StandingsTab standings={standings} teams={teams} matches={matches} isAdmin={isAdmin} onGenerate={handleGenerateFixtures} onReset={handleResetAll}/>}
        {tab==='matches' && <MatchesTab teams={teams} matches={matches} isAdmin={isAdmin} onEdit={setEditMatch} onEditDate={setEditDateMatch} filterRank={filterRank} setFilterRank={setFilterRank} filterTeam={filterTeam} setFilterTeam={setFilterTeam} filterDate={filterDate} setFilterDate={setFilterDate}/>}
        {tab==='players' && <PlayersTab playerStats={playerStats} teams={teams} isAdmin={isAdmin} onEdit={setEditPlayer}/>}
        {tab==='squads' && <SquadsTab teams={teams} isAdmin={isAdmin} onEditTeam={setEditTeam} onEditPlayer={setEditPlayer} onAddPlayer={setAddPlayerTeamId} onRemovePlayer={handleRemovePlayer}/>}
      </main>

      {editMatch && <MatchModal match={editMatch} teams={teams} onSave={handleSaveMatch} onClose={()=>setEditMatch(null)}/>}
      {editDateMatch && <DateModal match={editDateMatch} onSave={handleSaveDate} onClose={()=>setEditDateMatch(null)}/>}
      {editPlayer && <PlayerModal player={editPlayer} teams={teams} onSave={handleSavePlayer} onClose={()=>setEditPlayer(null)}/>}
      {editTeam && <TeamModal team={editTeam} onSave={handleSaveTeam} onClose={()=>setEditTeam(null)}/>}
      {addPlayerTeamId && <AddPlayerModal teamId={addPlayerTeamId} onSave={handleAddPlayer} onClose={()=>setAddPlayerTeamId(null)}/>}
    </div>
  );
}

function StandingsTab({ standings, teams, matches, isAdmin, onGenerate, onReset }) {
  const played = matches.filter(m=>m.played).length;
  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-800">Puan Durumu</h2>
        {isAdmin && <div className="flex gap-2">
          <button onClick={onGenerate} className="bg-amber-500 text-white px-3 py-1.5 rounded text-sm hover:bg-amber-600 font-medium">🔄 Fikstur Olustur</button>
          <button onClick={onReset} className="bg-gray-500 text-white px-3 py-1.5 rounded text-sm hover:bg-gray-600 font-medium">↺ Sifirla</button>
        </div>}
      </div>
      <div className="text-sm text-gray-400 mb-4">{played}/{matches.length} mac oynandi</div>
      <div className="bg-white rounded-xl shadow-sm border border-amber-100 overflow-x-auto">
        <table className="w-full text-sm min-w-[400px]">
          <thead className="bg-amber-50"><tr>
            <th className="text-left px-4 py-3 text-gray-500">#</th>
            <th className="text-left px-4 py-3 text-gray-600 font-semibold">TAKIM</th>
            <th className="text-center px-3 py-3 text-gray-500">O</th>
            <th className="text-center px-3 py-3 text-green-600 font-semibold">G</th>
            <th className="text-center px-3 py-3 text-red-500 font-semibold">M</th>
            <th className="text-center px-3 py-3 text-gray-500">SA</th>
            <th className="text-center px-3 py-3 text-gray-500">SV</th>
            <th className="text-center px-3 py-3 text-amber-600 font-bold">P</th>
          </tr></thead>
          <tbody>
            {standings.map((t,i) => (
              <tr key={t.id} className="border-t border-gray-100 hover:bg-amber-50/50">
                <td className="px-4 py-3 text-gray-400 font-bold">{i+1}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Avatar src={t.logo} name={t.name} color={t.color} size={7}/>
                    <span className="font-medium text-gray-800">{t.name}</span>
                  </div>
                </td>
                <td className="text-center px-3 py-3 text-gray-600">{t.played}</td>
                <td className="text-center px-3 py-3 text-green-600 font-semibold">{t.W}</td>
                <td className="text-center px-3 py-3 text-red-500 font-semibold">{t.L}</td>
                <td className="text-center px-3 py-3 text-gray-500">{t.SA}</td>
                <td className="text-center px-3 py-3 text-gray-500">{t.SB}</td>
                <td className="text-center px-3 py-3 font-bold text-amber-600 text-base">{t.pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MatchesTab({ teams, matches, isAdmin, onEdit, onEditDate, filterRank, setFilterRank, filterTeam, setFilterTeam, filterDate, setFilterDate }) {
  const sorted = [...matches].sort((a,b) => {
    if (a.matchDate && b.matchDate) return new Date(a.matchDate) - new Date(b.matchDate);
    if (a.matchDate) return -1;
    if (b.matchDate) return 1;
    return 0;
  });

  const filtered = sorted.filter(m => {
    if (filterRank !== 'all') {
      const pA = teams.flatMap(t=>t.players).find(p=>p.id===m.playerAId);
      if (!pA || pA.rank !== filterRank) return false;
    }
    if (filterTeam !== 'all' && m.teamAId !== filterTeam && m.teamBId !== filterTeam) return false;
    if (filterDate && m.matchDate !== filterDate) return false;
    return true;
  });

  const byDate = {};
  filtered.forEach(m => {
    const key = m.matchDate || '__nodate__';
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(m);
  });

  const dateKeys = Object.keys(byDate).sort((a,b) => {
    if (a === '__nodate__') return 1;
    if (b === '__nodate__') return -1;
    return new Date(a) - new Date(b);
  });

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-5 items-center">
        <h2 className="text-xl font-bold text-gray-800">Maclar</h2>
        <select value={filterRank} onChange={e=>setFilterRank(e.target.value)} className="border border-gray-200 rounded px-3 py-1.5 text-sm bg-white">
          <option value="all">Tum Klasmanlar</option>
          {['A','B','C','D'].map(r=><option key={r} value={r}>Klasman {r}</option>)}
        </select>
        <select value={filterTeam} onChange={e=>setFilterTeam(e.target.value)} className="border border-gray-200 rounded px-3 py-1.5 text-sm bg-white">
          <option value="all">Tum Takimlar</option>
          {teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <input type="date" value={filterDate} onChange={e=>setFilterDate(e.target.value)}
          className="border border-gray-200 rounded px-3 py-1.5 text-sm bg-white"/>
        {filterDate && <button onClick={()=>setFilterDate('')} className="text-xs text-gray-400 hover:text-gray-600 underline">Temizle</button>}
        <span className="text-sm text-gray-400">{filtered.filter(m=>m.played).length}/{filtered.length} oynandi</span>
      </div>

      {dateKeys.map(dateKey => (
        <div key={dateKey} className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-bold text-gray-600 bg-white border border-gray-200 px-3 py-1 rounded-full shadow-sm">
              {dateKey === '__nodate__' ? 'Tarih Belirlenmemis' : ('📅 ' + fmtDate(dateKey))}
            </span>
            <span className="text-xs text-gray-400">{byDate[dateKey].filter(m=>m.played).length}/{byDate[dateKey].length}</span>
          </div>
          <div className="space-y-2">
            {byDate[dateKey].map(m => {
              const tA=teams.find(t=>t.id===m.teamAId)||{}, tB=teams.find(t=>t.id===m.teamBId)||{};
              const pA=tA.players?.find(p=>p.id===m.playerAId)||{}, pB=tB.players?.find(p=>p.id===m.playerBId)||{};
              const rank = pA.rank || pB.rank;
              return (
                <div key={m.id} className={"bg-white rounded-lg border " + (m.played?'border-green-200 bg-green-50/30':'border-gray-100')}>
                  <div className="flex items-center gap-2 px-3 py-3">
                    {rank && <span className={"text-xs font-bold px-1.5 py-0.5 rounded-full shrink-0 " + (RANK_COLORS[rank]||'bg-gray-200')}>{rank}</span>}
                    <div className="flex-1 flex items-center justify-end gap-2 min-w-0">
                      <div className="text-right min-w-0">
                        <div className="font-medium text-gray-800 text-sm truncate">{pA.name}</div>
                        <div className="text-xs text-gray-400 truncate">{tA.name}</div>
                      </div>
                      <Avatar src={pA.photo} name={pA.name} color={tA.color} size={9}/>
                    </div>
                    <div className="text-center min-w-[60px] shrink-0">
                      {m.played ? <div>
                        <div className="font-bold text-gray-800 text-base">{m.setA}<span className="text-gray-300 mx-1">-</span>{m.setB}</div>
                        <div className="text-xs text-gray-400">{m.pointsA}-{m.pointsB}</div>
                      </div> : <div className="text-xs text-gray-300 font-medium">vs</div>}
                    </div>
                    <div className="flex-1 flex items-center gap-2 min-w-0">
                      <Avatar src={pB.photo} name={pB.name} color={tB.color} size={9}/>
                      <div className="min-w-0">
                        <div className="font-medium text-gray-800 text-sm truncate">{pB.name}</div>
                        <div className="text-xs text-gray-400 truncate">{tB.name}</div>
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex gap-1 shrink-0 ml-1">
                        <button onClick={e=>{e.stopPropagation();onEditDate(m);}} title="Tarih gir" className="text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded p-1 text-sm">📅</button>
                        <button onClick={e=>{e.stopPropagation();onEdit(m);}} title="Skor gir" className="text-amber-400 hover:text-amber-600 hover:bg-amber-50 rounded p-1 text-sm">✏️</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {filtered.length === 0 && <div className="text-center py-16 text-gray-300"><div className="text-5xl mb-3">🏓</div><div>Mac bulunamadi</div></div>}
    </div>
  );
}

function PlayersTab({ playerStats, teams, isAdmin, onEdit }) {
  const [rankFilter, setRankFilter] = useState('all');
  const [teamFilter, setTeamFilter] = useState('all');
  const filtered = playerStats.filter(p => {
    if (rankFilter !== 'all' && p.rank !== rankFilter) return false;
    if (teamFilter !== 'all' && p.teamId !== teamFilter) return false;
    return true;
  });
  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-800">Oyuncu Istatistikleri</h2>
      </div>
      <div className="flex gap-3 mb-4 flex-wrap">
        <select value={rankFilter} onChange={e=>setRankFilter(e.target.value)} className="border border-gray-200 rounded px-3 py-1.5 text-sm bg-white">
          <option value="all">Tum Klasmanlar</option>
          {['A','B','C','D'].map(r=><option key={r} value={r}>Klasman {r}</option>)}
        </select>
        <select value={teamFilter} onChange={e=>setTeamFilter(e.target.value)} className="border border-gray-200 rounded px-3 py-1.5 text-sm bg-white">
          <option value="all">Tum Takimlar</option>
          {teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-amber-100 overflow-x-auto">
        <table className="w-full text-sm min-w-[360px]">
          <thead className="bg-amber-50"><tr>
            <th className="text-left px-4 py-2 text-gray-500">#</th>
            <th className="text-left px-4 py-2 text-gray-600">OYUNCU</th>
            <th className="text-center px-2 py-2 text-gray-500">KLS</th>
            <th className="text-center px-2 py-2 text-gray-500">O</th>
            <th className="text-center px-2 py-2 text-green-600">G</th>
            <th className="text-center px-2 py-2 text-red-500">M</th>
            <th className="text-center px-2 py-2 text-amber-600 font-bold">P</th>
          </tr></thead>
          <tbody>
            {filtered.map((p,i) => (
              <tr key={p.id} onClick={()=>isAdmin&&onEdit(p)} className={"border-t border-gray-100 " + (isAdmin?'cursor-pointer hover:bg-amber-50/50':'')}>
                <td className="px-4 py-2.5 text-gray-400 font-bold">{i+1}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Avatar src={p.photo} name={p.name} color={p.teamColor} size={9}/>
                    <div>
                      <div className="font-medium text-gray-800">{p.name}</div>
                      <div className="text-xs text-gray-400">{p.teamName}</div>
                    </div>
                  </div>
                </td>
                <td className="text-center px-2 py-2.5"><span className={"text-xs px-1.5 py-0.5 rounded-full font-bold " + (RANK_COLORS[p.rank]||'bg-gray-200')}>{p.rank||'-'}</span></td>
                <td className="text-center px-2 py-2.5 text-gray-600">{p.played}</td>
                <td className="text-center px-2 py-2.5 text-green-600 font-semibold">{p.W}</td>
                <td className="text-center px-2 py-2.5 text-red-500 font-semibold">{p.L}</td>
                <td className="text-center px-2 py-2.5 font-bold text-amber-600">{p.pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SquadsTab({ teams, isAdmin, onEditTeam, onEditPlayer, onAddPlayer, onRemovePlayer }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-4">Kadrolar</h2>
      <div className="space-y-6">
        {teams.map(t => (
          <div key={t.id} className="bg-white rounded-xl border border-amber-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-amber-50" style={{borderLeftWidth:4,borderLeftColor:t.color}}>
              <div className="flex items-center gap-3">
                <Avatar src={t.logo} name={t.name} color={t.color} size={10}/>
                <div><div className="font-bold text-gray-800 text-lg">{t.name}</div><div className="text-xs text-gray-400">{t.players.length} oyuncu</div></div>
              </div>
              {isAdmin && <div className="flex gap-2">
                <button onClick={()=>onEditTeam(t)} className="bg-blue-50 text-blue-600 px-3 py-1.5 rounded text-sm hover:bg-blue-100 font-medium">✏️ Duzenle</button>
                <button onClick={()=>onAddPlayer(t.id)} className="bg-green-50 text-green-600 px-3 py-1.5 rounded text-sm hover:bg-green-100 font-medium">+ Ekle</button>
              </div>}
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {t.players.map(p => (
                  <div key={p.id} className="relative group">
                    <div onClick={()=>isAdmin&&onEditPlayer({...p,teamId:t.id})} className={"text-center p-3 rounded-xl border border-gray-100 hover:border-amber-200 transition-colors " + (isAdmin?'cursor-pointer':'')}>
                      <div className="flex justify-center mb-2">
                        <Avatar src={p.photo} name={p.name} color={t.color} size={14}/>
                      </div>
                      <div className="font-medium text-gray-800 text-sm truncate">{p.name}</div>
                      <div className="mt-1"><span className={"text-xs px-1.5 py-0.5 rounded-full font-bold " + (RANK_COLORS[p.rank]||'bg-gray-200')}>{p.rank||'-'}</span></div>
                    </div>
                    {isAdmin && <button onClick={e=>{e.stopPropagation();onRemovePlayer(p.id);}} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow">x</button>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DateModal({ match, onSave, onClose }) {
  const [matchDate, setMatchDate] = useState(match.matchDate || '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave(match.id, matchDate);
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs" onClick={e=>e.stopPropagation()}>
        <div className="p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-1">Mac Tarihi</h3>
          <p className="text-xs text-gray-400 mb-5">Skoru daha sonra girebilirsiniz</p>
          <div className="mb-6">
            <label className="text-sm font-medium text-gray-600 block mb-2">Tarih Sec</label>
            <input type="date" value={matchDate} onChange={e=>setMatchDate(e.target.value)}
              className="border rounded-xl px-3 py-3 w-full text-sm focus:border-amber-400 focus:outline-none text-center text-lg"/>
          </div>
          {matchDate && (
            <p className="text-center text-amber-600 font-medium text-sm mb-4">{fmtDate(matchDate)}</p>
          )}
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl hover:bg-gray-50">Iptal</button>
            <button onClick={handleSave} disabled={saving} className="flex-1 bg-amber-500 text-white py-2.5 rounded-xl hover:bg-amber-600 font-medium disabled:opacity-50">
              {saving?'Kaydediliyor...':'Kaydet'}
            </button>
          </div>
          {match.matchDate && (
            <button onClick={async()=>{setSaving(true);await onSave(match.id,'');}} className="w-full mt-2 text-xs text-red-400 hover:text-red-600 py-1">Tarihi kaldir</button>
          )}
        </div>
      </div>
    </div>
  );
}

function MatchModal({ match, teams, onSave, onClose }) {
  const tA=teams.find(t=>t.id===match.teamAId)||{}, tB=teams.find(t=>t.id===match.teamBId)||{};
  const pA=tA.players?.find(p=>p.id===match.playerAId)||{}, pB=tB.players?.find(p=>p.id===match.playerBId)||{};
  const [sets, setSets] = useState(match.sets?.length>0?match.sets:[{a:'',b:''},{a:'',b:''},{a:'',b:''}]);
  const [matchDate, setMatchDate] = useState(match.matchDate||'');
  const [saving, setSaving] = useState(false);

  const setA = sets.filter(s=>+s.a>+s.b).length;
  const setB = sets.filter(s=>+s.b>+s.a).length;

  function setVal(i,side,v) { setSets(prev=>prev.map((s,idx)=>idx===i?{...s,[side]:v}:s)); }
  function addSet() { setSets(prev=>[...prev,{a:'',b:''}]); }
  function removeSet(i) { if(sets.length>2) setSets(prev=>prev.filter((_,idx)=>idx!==i)); }

  async function handleSave() {
    const filled = sets.filter(s=>s.a!==''&&s.b!=='');
    if (filled.length < 2) { alert('En az 2 set giriniz.'); return; }
    setSaving(true);
    await onSave(match.id, filled, matchDate);
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e=>e.stopPropagation()}>
        <div className="p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">Mac Sonucu Gir</h3>
          <div className="flex items-center justify-between mb-4">
            <div className="text-center flex-1">
              <div className="flex justify-center mb-1">
                <Avatar src={pA.photo} name={pA.name} color={tA.color||'#999'} size={12}/>
              </div>
              <div className="font-semibold text-sm">{pA.name}</div>
              <div className="text-xs text-gray-400">{tA.name}</div>
              <div className={"text-3xl font-bold mt-1 " + (setA>setB?'text-green-500':setA<setB?'text-red-400':'text-gray-400')}>{setA}</div>
            </div>
            <div className="text-gray-200 text-2xl mx-2">vs</div>
            <div className="text-center flex-1">
              <div className="flex justify-center mb-1">
                <Avatar src={pB.photo} name={pB.name} color={tB.color||'#999'} size={12}/>
              </div>
              <div className="font-semibold text-sm">{pB.name}</div>
              <div className="text-xs text-gray-400">{tB.name}</div>
              <div className={"text-3xl font-bold mt-1 " + (setB>setA?'text-green-500':setB<setA?'text-red-400':'text-gray-400')}>{setB}</div>
            </div>
          </div>
          <div className="mb-4">
            <label className="text-sm font-medium text-gray-600 block mb-1">Mac Tarihi (opsiyonel)</label>
            <input type="date" value={matchDate} onChange={e=>setMatchDate(e.target.value)}
              className="border rounded-xl px-3 py-2 w-full text-sm focus:border-amber-400 focus:outline-none"/>
          </div>
          <div className="space-y-2 mb-4">
            {sets.map((s,i)=>(
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-10 shrink-0">Set {i+1}</span>
                <input type="number" value={s.a} onChange={e=>setVal(i,'a',e.target.value)} min="0" placeholder="0"
                  className="border rounded-lg px-2 py-2 w-16 text-center text-sm focus:border-amber-400 focus:outline-none"/>
                <span className="text-gray-300 font-bold">—</span>
                <input type="number" value={s.b} onChange={e=>setVal(i,'b',e.target.value)} min="0" placeholder="0"
                  className="border rounded-lg px-2 py-2 w-16 text-center text-sm focus:border-amber-400 focus:outline-none"/>
                {sets.length > 2 && <button onClick={()=>removeSet(i)} className="text-red-400 hover:text-red-600 text-xs ml-1">x</button>}
              </div>
            ))}
            <button onClick={addSet} className="text-amber-500 text-sm hover:text-amber-700 font-medium mt-1">+ Set Ekle</button>
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl hover:bg-gray-50">Iptal</button>
            <button onClick={handleSave} disabled={saving} className="flex-1 bg-amber-500 text-white py-2.5 rounded-xl hover:bg-amber-600 font-medium disabled:opacity-50">
              {saving?'Kaydediliyor...':'Kaydet'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlayerModal({ player, teams, onSave, onClose }) {
  const team = teams.find(t=>t.players?.some(p=>p.id===player.id)) || teams.find(t=>t.id===player.teamId) || {};
  const teamColor = team.color || '#999';
  const [name, setName] = useState(player.name||'');
  const [rank, setRank] = useState(player.rank||'B');
  const [photo, setPhoto] = useState(player.photo||'');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();

  async function handleFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    setPhoto(await compressImage(file));
  }
  async function handleSave() {
    if(!name.trim()) return;
    setSaving(true);
    await onSave({...player, name:name.trim(), rank, photo});
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={e=>e.stopPropagation()}>
        <div className="p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">Oyuncu Duzenle</h3>
          <div className="flex flex-col items-center mb-5">
            <div className="relative cursor-pointer" onClick={()=>fileRef.current?.click()}>
              <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-amber-200 flex-shrink-0" style={{width:96,height:96}}>
                {photo
                  ? <img src={photo} style={{width:'100%',height:'100%',objectFit:'cover',objectPosition:'center',display:'block'}}/>
                  : <div style={{width:'100%',height:'100%',background:teamColor,display:'flex',alignItems:'center',justifyContent:'center',fontSize:36,fontWeight:'bold',color:'white'}}>{(name||'?')[0].toUpperCase()}</div>
                }
              </div>
              <div className="absolute bottom-1 right-1 bg-amber-500 text-white rounded-full w-7 h-7 flex items-center justify-center shadow text-sm">📷</div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile}/>
            <span className="text-xs text-gray-400 mt-2">Fotograf eklemek icin tikla</span>
          </div>
          <div className="space-y-4">
            <div><label className="text-sm font-medium text-gray-600 block mb-1">Ad Soyad</label>
              <input value={name} onChange={e=>setName(e.target.value)} className="border rounded-xl px-3 py-2 w-full text-sm focus:border-amber-400 focus:outline-none"/></div>
            <div><label className="text-sm font-medium text-gray-600 block mb-1">Klasman</label>
              <div className="flex gap-2">{RANKS.map(r=>(
                <button key={r} onClick={()=>setRank(r)} className={"flex-1 py-2 rounded-xl text-sm font-bold border-2 transition-all " + (rank===r?'border-amber-500 bg-amber-50 text-amber-700':'border-gray-200 text-gray-400 hover:border-gray-300')}>{r}</button>
              ))}</div>
            </div>
          </div>
          <div className="flex gap-3 mt-5">
            <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl hover:bg-gray-50">Iptal</button>
            <button onClick={handleSave} disabled={saving} className="flex-1 bg-amber-500 text-white py-2.5 rounded-xl hover:bg-amber-600 font-medium disabled:opacity-50">{saving?'Kaydediliyor...':'Kaydet'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamModal({ team, onSave, onClose }) {
  const [name, setName] = useState(team.name||'');
  const [color, setColor] = useState(team.color||'#003399');
  const [logo, setLogo] = useState(team.logo||'');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();

  async function handleFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    setLogo(await compressImage(file));
  }
  async function handleSave() {
    if(!name.trim()) return;
    setSaving(true);
    await onSave({...team, name:name.trim(), color, logo});
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={e=>e.stopPropagation()}>
        <div className="p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">Takim Duzenle</h3>
          <div className="flex flex-col items-center mb-5">
            <div className="relative cursor-pointer" onClick={()=>fileRef.current?.click()}>
              <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-blue-200 flex-shrink-0" style={{width:96,height:96}}>
                {logo
                  ? <img src={logo} style={{width:'100%',height:'100%',objectFit:'cover',objectPosition:'center',display:'block'}}/>
                  : <div style={{width:'100%',height:'100%',background:color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:36,color:'white'}}>🏅</div>
                }
              </div>
              <div className="absolute bottom-1 right-1 bg-blue-500 text-white rounded-full w-7 h-7 flex items-center justify-center shadow text-sm">📷</div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile}/>
          </div>
          <div className="space-y-4">
            <div><label className="text-sm font-medium text-gray-600 block mb-1">Takim Adi</label>
              <input value={name} onChange={e=>setName(e.target.value)} className="border rounded-xl px-3 py-2 w-full text-sm focus:border-blue-400 focus:outline-none"/></div>
            <div><label className="text-sm font-medium text-gray-600 block mb-1">Renk</label>
              <div className="flex items-center gap-3">
                <input type="color" value={color} onChange={e=>setColor(e.target.value)} className="w-12 h-10 rounded-lg cursor-pointer border border-gray-200"/>
                <span className="text-sm text-gray-500 font-mono">{color}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-3 mt-5">
            <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl hover:bg-gray-50">Iptal</button>
            <button onClick={handleSave} disabled={saving} className="flex-1 bg-blue-500 text-white py-2.5 rounded-xl hover:bg-blue-600 font-medium disabled:opacity-50">{saving?'Kaydediliyor...':'Kaydet'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddPlayerModal({ teamId, onSave, onClose }) {
  const [name, setName] = useState('');
  const [rank, setRank] = useState('B');
  const [photo, setPhoto] = useState('');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();

  async function handleFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    setPhoto(await compressImage(file));
  }
  async function handleSave() {
    if(!name.trim()) return;
    setSaving(true);
    await onSave(teamId, { name:name.trim(), rank, photo });
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={e=>e.stopPropagation()}>
        <div className="p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">Oyuncu Ekle</h3>
          <div className="flex flex-col items-center mb-5">
            <div className="relative cursor-pointer" onClick={()=>fileRef.current?.click()}>
              <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-dashed border-amber-300 flex-shrink-0" style={{width:96,height:96}}>
                {photo
                  ? <img src={photo} style={{width:'100%',height:'100%',objectFit:'cover',objectPosition:'center',display:'block'}}/>
                  : <div style={{width:'100%',height:'100%',background:'#fef3c7',display:'flex',alignItems:'center',justifyContent:'center',fontSize:40,color:'#f59e0b'}}>+</div>
                }
              </div>
              <div className="absolute bottom-1 right-1 bg-amber-500 text-white rounded-full w-7 h-7 flex items-center justify-center shadow text-sm">📷</div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile}/>
          </div>
          <div className="space-y-4">
            <div><label className="text-sm font-medium text-gray-600 block mb-1">Ad Soyad</label>
              <input value={name} onChange={e=>setName(e.target.value)} placeholder="Oyuncu adi" className="border rounded-xl px-3 py-2 w-full text-sm focus:border-amber-400 focus:outline-none"/></div>
            <div><label className="text-sm font-medium text-gray-600 block mb-1">Klasman</label>
              <div className="flex gap-2">{RANKS.map(r=>(
                <button key={r} onClick={()=>setRank(r)} className={"flex-1 py-2 rounded-xl text-sm font-bold border-2 transition-all " + (rank===r?'border-amber-500 bg-amber-50 text-amber-700':'border-gray-200 text-gray-400 hover:border-gray-300')}>{r}</button>
              ))}</div>
            </div>
          </div>
          <div className="flex gap-3 mt-5">
            <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl hover:bg-gray-50">Iptal</button>
            <button onClick={handleSave} disabled={saving} className="flex-1 bg-amber-500 text-white py-2.5 rounded-xl hover:bg-amber-600 font-medium disabled:opacity-50">{saving?'Ekleniyor...':'Ekle'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
// v5 - date modal, avatar component, photo fix
