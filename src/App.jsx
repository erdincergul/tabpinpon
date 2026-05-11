import { useState, useEffect, useRef, useCallback } from 'react';
import {
  isSupabaseConfigured, supabase,
  dbGetTeams, dbGetPlayers, dbGetMatches,
  dbUpsertTeam, dbDeleteTeam,
  dbUpsertPlayer, dbDeletePlayer,
  dbUpsertMatch, dbInsertMatches, dbDeleteAllMatches, dbResetMatchResults,
  subscribeToChanges
} from './supabase.js';

const ADMIN_PASSWORD = 'Admin2026Tab2026';
const STORAGE_KEY = 'tabpinpon_data_v2';

const DEFAULT_TEAMS = [
  { id: 'fb', name: 'Fenerbahçe', color: '#003399', logo: '', players: [
    { id: 'fb1', name: 'Şenol', photo: '', rank: 'A' },
    { id: 'fb2', name: 'Fatih', photo: '', rank: 'A' },
    { id: 'fb3', name: 'Samet', photo: '', rank: 'B' },
    { id: 'fb4', name: 'Gökhan', photo: '', rank: 'B' },
    { id: 'fb5', name: 'Can', photo: '', rank: 'B' },
    { id: 'fb6', name: 'Süleyman', photo: '', rank: 'C' },
    { id: 'fb7', name: 'Burak', photo: '', rank: 'C' },
  ]},
  { id: 'gs', name: 'Galatasaray', color: '#CC0000', logo: '', players: [
    { id: 'gs1', name: 'Güven', photo: '', rank: 'A' },
    { id: 'gs2', name: 'Emre Y.', photo: '', rank: 'A' },
    { id: 'gs3', name: 'Uğur', photo: '', rank: 'B' },
    { id: 'gs4', name: 'Erdinç', photo: '', rank: 'B' },
    { id: 'gs5', name: 'Emre M.', photo: '', rank: 'B' },
    { id: 'gs6', name: 'Çağatay', photo: '', rank: 'C' },
    { id: 'gs7', name: 'Mehmet', photo: '', rank: 'C' },
  ]},
  { id: 'bjk', name: 'Beşiktaş', color: '#1a1a1a', logo: '', players: [
    { id: 'bjk1', name: 'Erhan', photo: '', rank: 'A' },
    { id: 'bjk2', name: 'Cemal', photo: '', rank: 'A' },
    { id: 'bjk3', name: 'Okan', photo: '', rank: 'B' },
    { id: 'bjk4', name: 'Mert', photo: '', rank: 'B' },
    { id: 'bjk5', name: 'Öner', photo: '', rank: 'B' },
    { id: 'bjk6', name: 'Mustafa', photo: '', rank: 'C' },
    { id: 'bjk7', name: 'Kadir', photo: '', rank: 'C' },
    { id: 'bjk8', name: 'Salih', photo: '', rank: 'C' },
  ]},
];

function genId() { return Math.random().toString(36).slice(2,9) + Date.now().toString(36); }

function generateFixtures(teams) {
  const matches = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const tA = teams[i], tB = teams[j];
      for (const pA of tA.players) {
        for (const pB of tB.players) {
          if (pA.rank === pB.rank) {
            matches.push({ id: genId(), teamAId: tA.id, teamBId: tB.id, playerAId: pA.id, playerBId: pB.id, sets: [], setA: 0, setB: 0, pointsA: 0, pointsB: 0, played: false });
          }
        }
      }
    }
  }
  return matches;
}

function loadLocal() {
  try { const r = localStorage.getItem(STORAGE_KEY); if (r) return JSON.parse(r); } catch {}
  return { teams: DEFAULT_TEAMS, matches: [] };
}
function saveLocal(teams, matches) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ teams, matches })); } catch {}
}

function mapDbMatch(m) {
  return { id: m.id, teamAId: m.team_a_id, teamBId: m.team_b_id, playerAId: m.player_a_id, playerBId: m.player_b_id, sets: m.sets || [], setA: m.sets_a || 0, setB: m.sets_b || 0, pointsA: m.points_a || 0, pointsB: m.points_b || 0, played: m.played || false };
}

function compressImage(file, maxW = 300) {
  return new Promise(res => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(maxW / img.width, 1);
        const c = document.createElement('canvas');
        c.width = img.width * ratio; c.height = img.height * ratio;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.7));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

const RANKS = ['A', 'B', 'C', 'D'];
const RANK_COLORS = { A: 'bg-yellow-400 text-yellow-900', B: 'bg-gray-300 text-gray-800', C: 'bg-orange-300 text-orange-900', D: 'bg-blue-200 text-blue-900' };

export default function App() {
  const [teams, setTeams] = useState([]);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(isSupabaseConfigured);
  const [tab, setTab] = useState('standings');
  const [isAdmin, setIsAdmin] = useState(false);
  const [pwInput, setPwInput] = useState('');
  const [pwError, setPwError] = useState(false);
  const [editMatch, setEditMatch] = useState(null);
  const [editPlayer, setEditPlayer] = useState(null);
  const [editTeam, setEditTeam] = useState(null);
  const [showAddPlayer, setShowAddPlayer] = useState(null);
  const [filterRank, setFilterRank] = useState('all');
  const [filterTeam, setFilterTeam] = useState('all');
  const [msg, setMsg] = useState('');

  // ── Load data ──────────────────────────────────────
  const loadFromSupabase = useCallback(async () => {
    try {
      const [teamsData, playersData, matchesData] = await Promise.all([dbGetTeams(), dbGetPlayers(), dbGetMatches()]);
      if (!teamsData) return false;
      const mergedTeams = teamsData.map(t => ({
        id: t.id, name: t.name, color: t.color, logo: t.logo || '',
        players: playersData.filter(p => p.team_id === t.id).map(p => ({ id: p.id, name: p.name, photo: p.photo || '', rank: p.rank || 'B' }))
      }));
      const mergedMatches = matchesData.map(mapDbMatch);
      setTeams(mergedTeams);
      setMatches(mergedMatches);
      saveLocal(mergedTeams, mergedMatches);
      return true;
    } catch (e) { console.error('Supabase load error:', e); return false; }
  }, []);

  useEffect(() => {
    async function init() {
      if (isSupabaseConfigured) {
        const ok = await loadFromSupabase();
        if (!ok) {
          const local = loadLocal();
          setTeams(local.teams);
          setMatches(local.matches);
          setOnline(false);
        }
      } else {
        const local = loadLocal();
        setTeams(local.teams);
        setMatches(local.matches);
      }
      setLoading(false);
    }
    init();
  }, [loadFromSupabase]);

  // ── Realtime subscription ──────────────────────────
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const unsub = subscribeToChanges(
      () => loadFromSupabase(),
      () => loadFromSupabase(),
      () => loadFromSupabase()
    );
    return unsub;
  }, [loadFromSupabase]);

  // ── Save locally when offline ──────────────────────
  useEffect(() => {
    if (!isSupabaseConfigured && teams.length > 0) saveLocal(teams, matches);
  }, [teams, matches]);

  function flash(m) { setMsg(m); setTimeout(() => setMsg(''), 3500); }
  function login() {
    if (pwInput === ADMIN_PASSWORD) { setIsAdmin(true); setPwError(false); setPwInput(''); }
    else { setPwError(true); }
  }

  // ── Standings ──────────────────────────────────────
  function calcStandings() {
    return teams.map(t => {
      const tm = matches.filter(m => m.played && (m.teamAId === t.id || m.teamBId === t.id));
      let W=0,L=0,SA=0,SB=0,PA=0,PB=0;
      tm.forEach(m => {
        const a = m.teamAId === t.id;
        const ws = a?m.setA:m.setB, ls = a?m.setB:m.setA;
        const pa = a?m.pointsA:m.pointsB, pb = a?m.pointsB:m.pointsA;
        if(ws>ls) W++; else L++;
        SA+=ws; SB+=ls; PA+=pa; PB+=pb;
      });
      return { ...t, played:tm.length, W, L, SA, SB, PA, PB, pts:W*3 };
    }).sort((a,b) => b.pts-a.pts || (b.SA-b.SB)-(a.SA-a.SB));
  }

  function calcPlayerStats() {
    return teams.flatMap(t => t.players.map(p => {
      const pm = matches.filter(m => m.played && (m.playerAId===p.id || m.playerBId===p.id));
      let W=0,L=0,SA=0,SB=0,PA=0,PB=0;
      pm.forEach(m => {
        const a = m.playerAId===p.id;
        const ws=a?m.setA:m.setB, ls=a?m.setB:m.setA;
        const pa=a?m.pointsA:m.pointsB, pb=a?m.pointsB:m.pointsA;
        if(ws>ls) W++; else L++;
        SA+=ws; SB+=ls; PA+=pa; PB+=pb;
      });
      return { ...p, teamId:t.id, teamName:t.name, teamColor:t.color, played:pm.length, W, L, SA, SB, PA, PB, pts:W*3 };
    })).sort((a,b) => b.pts-a.pts || (b.SA-b.SB)-(a.SA-a.SB));
  }
  // ── Team actions ───────────────────────────────────
  async function handleSaveTeam(updated) {
    if (isSupabaseConfigured) {
      try { await dbUpsertTeam(updated); } catch(e) { flash('Hata: ' + e.message); return; }
      await loadFromSupabase();
    } else {
      setTeams(ts => ts.map(t => t.id===updated.id ? updated : t));
    }
    setEditTeam(null); flash('Takım güncellendi.');
  }

  // ── Player actions ─────────────────────────────────
  async function handleSavePlayer(updated) {
    if (isSupabaseConfigured) {
      try { await dbUpsertPlayer({ ...updated, teamId: updated.teamId || teams.find(t=>t.players.some(p=>p.id===updated.id))?.id }); } catch(e) { flash('Hata: ' + e.message); return; }
      await loadFromSupabase();
    } else {
      setTeams(ts => ts.map(t => ({ ...t, players: t.players.map(p => p.id===updated.id ? updated : p) })));
    }
    setEditPlayer(null); flash('Oyuncu güncellendi.');
  }

  async function handleAddPlayer(teamId, player) {
    const newPlayer = { ...player, id: genId() };
    if (isSupabaseConfigured) {
      const team = teams.find(t=>t.id===teamId);
      const order = team ? team.players.length : 0;
      try { await dbUpsertPlayer({ ...newPlayer, teamId, displayOrder: order }); } catch(e) { flash('Hata: ' + e.message); return; }
      await loadFromSupabase();
    } else {
      setTeams(ts => ts.map(t => t.id===teamId ? { ...t, players:[...t.players, newPlayer] } : t));
    }
    setShowAddPlayer(null); flash('Oyuncu eklendi.');
  }

  async function handleRemovePlayer(teamId, playerId) {
    if (!confirm('Bu oyuncuyu silmek istiyor musunuz?')) return;
    if (isSupabaseConfigured) {
      try { await dbDeletePlayer(playerId); } catch(e) { flash('Hata: ' + e.message); return; }
      await loadFromSupabase();
    } else {
      setTeams(ts => ts.map(t => t.id===teamId ? { ...t, players:t.players.filter(p=>p.id!==playerId) } : t));
      setMatches(ms => ms.filter(m => m.playerAId!==playerId && m.playerBId!==playerId));
    }
    flash('Oyuncu silindi.');
  }

  // ── Fixture actions ────────────────────────────────
  async function handleGenerateFixtures() {
    if (!confirm('Mevcut fikstür silinip yeniden oluşturulacak. Onaylıyor musunuz?')) return;
    const newMatches = generateFixtures(teams);
    if (newMatches.length === 0) { flash('Fikstür oluşturulamadı. Oyunculara klasman atandığından emin olun.'); return; }
    if (isSupabaseConfigured) {
      try {
        await dbDeleteAllMatches();
        await dbInsertMatches(newMatches);
      } catch(e) { flash('Hata: ' + e.message); return; }
      await loadFromSupabase();
    } else {
      setMatches(newMatches);
    }
    flash('Fikstür oluşturuldu! ' + newMatches.length + ' maç.');
  }

  async function handleResetAll() {
    if (!confirm('Tüm maç sonuçları sıfırlanacak. Onaylıyor musunuz?')) return;
    if (isSupabaseConfigured) {
      try { await dbResetMatchResults(); } catch(e) { flash('Hata: ' + e.message); return; }
      await loadFromSupabase();
    } else {
      setMatches(ms => ms.map(m => ({ ...m, sets:[], setA:0, setB:0, pointsA:0, pointsB:0, played:false })));
    }
    flash('Tüm sonuçlar sıfırlandı.');
  }

  // ── Match save ─────────────────────────────────────
  async function handleSaveMatch(matchId, sets) {
    let setA=0, setB=0, pointsA=0, pointsB=0;
    sets.forEach(s => { if(s.a>s.b) setA++; else if(s.b>s.a) setB++; pointsA+=s.a; pointsB+=s.b; });
    const updated = { id:matchId, ...matches.find(m=>m.id===matchId), sets, setA, setB, pointsA, pointsB, played:sets.length>0 };
    if (isSupabaseConfigured) {
      try { await dbUpsertMatch(updated); } catch(e) { flash('Hata: ' + e.message); return; }
      // Realtime will update state automatically, but also update locally for instant feedback
      setMatches(ms => ms.map(m => m.id===matchId ? updated : m));
    } else {
      setMatches(ms => ms.map(m => m.id===matchId ? updated : m));
    }
    setEditMatch(null); flash('Maç kaydedildi! ✓');
  }

  const standings = calcStandings();
  const playerStats = calcPlayerStats();

  if (loading) return (
    <div className="min-h-screen bg-amber-50 flex items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-3">🏓</div>
        <div className="text-gray-500">Yükleniyor...</div>
      </div>
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
                Pinpon Turnuvası
                {isSupabaseConfigured ? <span className="bg-green-100 text-green-600 px-1 rounded text-xs">● Canlı</span> : <span className="bg-yellow-100 text-yellow-600 px-1 rounded text-xs">○ Offline</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin ? (
              <span onClick={() => setIsAdmin(false)} className="text-xs bg-green-100 text-green-700 px-3 py-1 rounded-full font-medium cursor-pointer hover:bg-green-200">✓ Admin</span>
            ) : (
              <div className="flex gap-1">
                <input type="password" value={pwInput} onChange={e=>setPwInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&login()}
                  placeholder="Şifre" className={`border rounded px-2 py-1 text-sm w-28 ${pwError?'border-red-400':'border-gray-300'}`} />
                <button onClick={login} className="bg-amber-500 text-white px-3 py-1 rounded text-sm hover:bg-amber-600">Giriş</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {msg && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-green-500 text-white px-6 py-2 rounded-full shadow-lg text-sm font-medium animate-bounce">{msg}</div>}

      <div className="max-w-5xl mx-auto px-4 pt-4">
        <div className="flex gap-1 border-b border-amber-200 overflow-x-auto">
          {[['standings','🏆 Puan Durumu'],['matches','⚔️ Maçlar'],['players','👤 Oyuncular'],['squads','👥 Kadrolar']].map(([k,v]) => (
            <button key={k} onClick={()=>setTab(k)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${tab===k?'border-amber-500 text-amber-600':'border-transparent text-gray-500 hover:text-gray-700'}`}>{v}</button>
          ))}
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {tab==='standings' && <StandingsTab standings={standings} teams={teams} matches={matches} isAdmin={isAdmin} onGenerate={handleGenerateFixtures} onReset={handleResetAll} />}
        {tab==='matches' && <MatchesTab teams={teams} matches={matches} isAdmin={isAdmin} onEdit={setEditMatch} filterRank={filterRank} setFilterRank={setFilterRank} filterTeam={filterTeam} setFilterTeam={setFilterTeam} />}
        {tab==='players' && <PlayersTab playerStats={playerStats} teams={teams} isAdmin={isAdmin} onEdit={setEditPlayer} />}
        {tab==='squads' && <SquadsTab teams={teams} isAdmin={isAdmin} onEditTeam={setEditTeam} onEditPlayer={setEditPlayer} onAddPlayer={setShowAddPlayer} onRemovePlayer={handleRemovePlayer} />}
      </main>

      {editMatch && <MatchModal match={editMatch} teams={teams} onSave={handleSaveMatch} onClose={()=>setEditMatch(null)} />}
      {editPlayer && <PlayerModal player={editPlayer} teams={teams} onSave={handleSavePlayer} onClose={()=>setEditPlayer(null)} />}
      {editTeam && <TeamModal team={editTeam} onSave={handleSaveTeam} onClose={()=>setEditTeam(null)} />}
      {showAddPlayer && <AddPlayerModal teamId={showAddPlayer} onSave={handleAddPlayer} onClose={()=>setShowAddPlayer(null)} />}
    </div>
  );
}
// ── StandingsTab ───────────────────────────────────
function StandingsTab({ standings, teams, matches, isAdmin, onGenerate, onReset }) {
  const played = matches.filter(m=>m.played).length;
  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-800">Puan Durumu</h2>
        {isAdmin && <div className="flex gap-2">
          <button onClick={onGenerate} className="bg-amber-500 text-white px-3 py-1.5 rounded text-sm hover:bg-amber-600 font-medium">🔄 Fikstür Oluştur</button>
          <button onClick={onReset} className="bg-gray-500 text-white px-3 py-1.5 rounded text-sm hover:bg-gray-600 font-medium">↺ Sıfırla</button>
        </div>}
      </div>
      <div className="text-sm text-gray-400 mb-4">{played}/{matches.length} maç oynandı</div>
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
                <td className="px-4 py-3"><div className="flex items-center gap-2">
                  {t.logo ? <img src={t.logo} className="w-7 h-7 rounded-full object-cover"/> : <span className="w-7 h-7 rounded-full block" style={{background:t.color}}/>}
                  <span className="font-medium text-gray-800">{t.name}</span>
                </div></td>
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

// ── MatchesTab ─────────────────────────────────────
function MatchesTab({ teams, matches, isAdmin, onEdit, filterRank, setFilterRank, filterTeam, setFilterTeam }) {
  const getTeam = id => teams.find(t=>t.id===id)||{name:'?',color:'#999'};
  const getPlayer = (tid,pid) => (teams.find(t=>t.id===tid)?.players||[]).find(p=>p.id===pid)||{name:'?'};

  const filtered = matches.filter(m => {
    const pA = getPlayer(m.teamAId, m.playerAId);
    if (filterRank!=='all' && pA.rank!==filterRank) return false;
    if (filterTeam!=='all' && m.teamAId!==filterTeam && m.teamBId!==filterTeam) return false;
    return true;
  });

  const groups = {};
  filtered.forEach(m => {
    const r = getPlayer(m.teamAId,m.playerAId).rank||'?';
    (groups[r] = groups[r]||[]).push(m);
  });

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-5 items-center">
        <h2 className="text-xl font-bold text-gray-800">Maçlar</h2>
        <select value={filterRank} onChange={e=>setFilterRank(e.target.value)} className="border border-gray-200 rounded px-3 py-1.5 text-sm bg-white">
          <option value="all">Tüm Klasmanlar</option>
          {['A','B','C','D'].map(r=><option key={r} value={r}>Klasman {r}</option>)}
        </select>
        <select value={filterTeam} onChange={e=>setFilterTeam(e.target.value)} className="border border-gray-200 rounded px-3 py-1.5 text-sm bg-white">
          <option value="all">Tüm Takımlar</option>
          {teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <span className="text-sm text-gray-400">{filtered.filter(m=>m.played).length}/{filtered.length} oynandı</span>
      </div>
      {Object.keys(groups).sort().map(rank => (
        <div key={rank} className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${RANK_COLORS[rank]||'bg-gray-200'}`}>Klasman {rank}</span>
            <span className="text-xs text-gray-400">{groups[rank].filter(m=>m.played).length}/{groups[rank].length}</span>
          </div>
          <div className="space-y-2">
            {groups[rank].map(m => {
              const tA=getTeam(m.teamAId), tB=getTeam(m.teamBId);
              const pA=getPlayer(m.teamAId,m.playerAId), pB=getPlayer(m.teamBId,m.playerBId);
              return (
                <div key={m.id} onClick={()=>isAdmin&&onEdit(m)}
                  className={`bg-white rounded-lg border px-4 py-3 flex items-center gap-2 ${isAdmin?'cursor-pointer hover:border-amber-300 active:bg-amber-50':''} ${m.played?'border-green-200 bg-green-50/30':'border-gray-100'}`}>
                  <div className="flex-1 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {pA.photo?<img src={pA.photo} className="w-8 h-8 rounded-full object-cover"/>:<div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{background:tA.color||'#999'}}>{(pA.name||'?')[0]}</div>}
                      <div><div className="font-medium text-gray-800 text-sm">{pA.name}</div><div className="text-xs text-gray-400">{tA.name}</div></div>
                    </div>
                  </div>
                  <div className="text-center min-w-[60px]">
                    {m.played ? <div>
                      <div className="font-bold text-gray-800 text-base">{m.setA}<span className="text-gray-300 mx-1">-</span>{m.setB}</div>
                      <div className="text-xs text-gray-400">{m.pointsA}-{m.pointsB}</div>
                    </div> : <div className="text-xs text-gray-300 font-medium">vs</div>}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      {pB.photo?<img src={pB.photo} className="w-8 h-8 rounded-full object-cover"/>:<div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{background:tB.color||'#999'}}>{(pB.name||'?')[0]}</div>}
                      <div><div className="font-medium text-gray-800 text-sm">{pB.name}</div><div className="text-xs text-gray-400">{tB.name}</div></div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {filtered.length===0 && <div className="text-center text-gray-400 py-16"><div className="text-5xl mb-3">🏓</div><div>Fikstür bulunamadı.<br/>Admin olarak giriş yapıp "Fikstür Oluştur" butonuna tıklayın.</div></div>}
    </div>
  );
}
// ── PlayersTab ─────────────────────────────────────
function PlayersTab({ playerStats, teams, isAdmin, onEdit }) {
  const [rankFilter, setRankFilter] = useState('all');
  const [teamFilter, setTeamFilter] = useState('all');
  const filtered = playerStats.filter(p => (rankFilter==='all'||p.rank===rankFilter) && (teamFilter==='all'||p.teamId===teamFilter));
  const top3 = [...filtered].sort((a,b)=>b.pts-a.pts).slice(0,3);
  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-4">Oyuncu İstatistikleri</h2>
      {top3.length>=3 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          {top3.map((p,i) => (
            <div key={p.id} onClick={()=>isAdmin&&onEdit(p)} className={`bg-white rounded-xl border border-amber-100 p-4 text-center shadow-sm ${isAdmin?'cursor-pointer hover:border-amber-300':''}`}>
              <div className="text-2xl mb-1">{['🥇','🥈','🥉'][i]}</div>
              {p.photo?<img src={p.photo} className="w-14 h-14 rounded-full object-cover mx-auto mb-2"/>:<div className="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold mx-auto mb-2" style={{background:p.teamColor}}>{p.name[0]}</div>}
              <div className="font-semibold text-gray-800 text-sm">{p.name}</div>
              <div className="text-xs text-gray-400 mb-1">{p.teamName}</div>
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${RANK_COLORS[p.rank]||'bg-gray-200'}`}>{p.rank}</span>
              <div className="text-amber-600 font-bold text-lg mt-1">{p.pts}P</div>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-3 mb-4 flex-wrap">
        <select value={rankFilter} onChange={e=>setRankFilter(e.target.value)} className="border border-gray-200 rounded px-3 py-1.5 text-sm bg-white">
          <option value="all">Tüm Klasmanlar</option>
          {['A','B','C','D'].map(r=><option key={r} value={r}>Klasman {r}</option>)}
        </select>
        <select value={teamFilter} onChange={e=>setTeamFilter(e.target.value)} className="border border-gray-200 rounded px-3 py-1.5 text-sm bg-white">
          <option value="all">Tüm Takımlar</option>
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
              <tr key={p.id} onClick={()=>isAdmin&&onEdit(p)} className={`border-t border-gray-100 hover:bg-amber-50/50 ${isAdmin?'cursor-pointer':''}`}>
                <td className="px-4 py-2.5 text-gray-400 font-bold">{i+1}</td>
                <td className="px-4 py-2.5"><div className="flex items-center gap-2">
                  {p.photo?<img src={p.photo} className="w-8 h-8 rounded-full object-cover"/>:<div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{background:p.teamColor}}>{p.name[0]}</div>}
                  <div><div className="font-medium text-gray-800">{p.name}</div><div className="text-xs text-gray-400">{p.teamName}</div></div>
                </div></td>
                <td className="text-center px-2 py-2.5"><span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${RANK_COLORS[p.rank]||'bg-gray-200'}`}>{p.rank||'-'}</span></td>
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

// ── SquadsTab ──────────────────────────────────────
function SquadsTab({ teams, isAdmin, onEditTeam, onEditPlayer, onAddPlayer, onRemovePlayer }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-4">Kadrolar</h2>
      <div className="space-y-6">
        {teams.map(t => (
          <div key={t.id} className="bg-white rounded-xl border border-amber-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-amber-50" style={{borderLeftWidth:4,borderLeftColor:t.color}}>
              <div className="flex items-center gap-3">
                {t.logo?<img src={t.logo} className="w-10 h-10 rounded-full object-cover"/>:<div className="w-10 h-10 rounded-full shrink-0" style={{background:t.color}}/>}
                <div><div className="font-bold text-gray-800 text-lg">{t.name}</div><div className="text-xs text-gray-400">{t.players.length} oyuncu</div></div>
              </div>
              {isAdmin && <div className="flex gap-2">
                <button onClick={()=>onEditTeam(t)} className="bg-blue-50 text-blue-600 px-3 py-1.5 rounded text-sm hover:bg-blue-100 font-medium">✏️ Düzenle</button>
                <button onClick={()=>onAddPlayer(t.id)} className="bg-green-50 text-green-600 px-3 py-1.5 rounded text-sm hover:bg-green-100 font-medium">+ Ekle</button>
              </div>}
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {t.players.map(p => (
                  <div key={p.id} className="relative group">
                    <div onClick={()=>isAdmin&&onEditPlayer({...p,teamId:t.id})} className={`bg-amber-50 rounded-lg p-3 text-center border border-amber-100 ${isAdmin?'cursor-pointer hover:border-amber-300':''}`}>
                      {p.photo?<img src={p.photo} className="w-14 h-14 rounded-full object-cover mx-auto mb-2"/>:<div className="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold mx-auto mb-2 shrink-0" style={{background:t.color}}>{p.name[0]}</div>}
                      <div className="font-medium text-gray-800 text-sm">{p.name}</div>
                      <div className="mt-1"><span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${RANK_COLORS[p.rank]||'bg-gray-200'}`}>{p.rank||'-'}</span></div>
                    </div>
                    {isAdmin && <button onClick={e=>{e.stopPropagation();onRemovePlayer(t.id,p.id)}} className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs hidden group-hover:flex items-center justify-center hover:bg-red-600 font-bold">×</button>}
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
// ── MatchModal ─────────────────────────────────────
function MatchModal({ match, teams, onSave, onClose }) {
  const getTeam = id => teams.find(t=>t.id===id)||{name:'?',color:'#999'};
  const getPlayer = (tid,pid) => (teams.find(t=>t.id===tid)?.players||[]).find(p=>p.id===pid)||{name:'?'};
  const tA=getTeam(match.teamAId), tB=getTeam(match.teamBId);
  const pA=getPlayer(match.teamAId,match.playerAId), pB=getPlayer(match.teamBId,match.playerBId);
  const [sets, setSets] = useState(match.sets?.length ? match.sets.map(s=>({a:String(s.a),b:String(s.b)})) : [{a:'',b:''},{a:'',b:''},{a:'',b:''}]);
  const [saving, setSaving] = useState(false);

  function setVal(i,side,v) { setSets(s=>s.map((x,j)=>j===i?{...x,[side]:v}:x)); }
  function addSet() { setSets(s=>[...s,{a:'',b:''}]); }
  function removeSet(i) { setSets(s=>s.filter((_,j)=>j!==i)); }

  let setA=0,setB=0;
  sets.forEach(s=>{const a=parseInt(s.a)||0,b=parseInt(s.b)||0;if(a>b)setA++;else if(b>a)setB++;});

  async function handleSave() {
    setSaving(true);
    const filled = sets.filter(s=>s.a!==''&&s.b!=='').map(s=>({a:parseInt(s.a)||0,b:parseInt(s.b)||0}));
    await onSave(match.id, filled);
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">Maç Sonucu Gir</h3>
          <div className="flex items-center justify-between mb-5">
            <div className="text-center flex-1">
              {pA.photo?<img src={pA.photo} className="w-12 h-12 rounded-full object-cover mx-auto mb-1"/>:<div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold mx-auto mb-1" style={{background:tA.color}}>{(pA.name||'?')[0]}</div>}
              <div className="font-semibold text-sm">{pA.name}</div>
              <div className="text-xs text-gray-400">{tA.name}</div>
              <div className={`text-3xl font-bold mt-1 ${setA>setB?'text-green-500':setA<setB?'text-red-400':'text-gray-400'}`}>{setA}</div>
            </div>
            <div className="text-gray-200 text-2xl mx-2">vs</div>
            <div className="text-center flex-1">
              {pB.photo?<img src={pB.photo} className="w-12 h-12 rounded-full object-cover mx-auto mb-1"/>:<div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold mx-auto mb-1" style={{background:tB.color}}>{(pB.name||'?')[0]}</div>}
              <div className="font-semibold text-sm">{pB.name}</div>
              <div className="text-xs text-gray-400">{tB.name}</div>
              <div className={`text-3xl font-bold mt-1 ${setB>setA?'text-green-500':setB<setA?'text-red-400':'text-gray-400'}`}>{setB}</div>
            </div>
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
                {sets.length>1 && <button onClick={()=>removeSet(i)} className="text-red-300 hover:text-red-500 text-xl leading-none">×</button>}
              </div>
            ))}
            <button onClick={addSet} className="text-amber-500 text-sm hover:text-amber-700 font-medium mt-1">+ Set Ekle</button>
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl hover:bg-gray-50">İptal</button>
            <button onClick={handleSave} disabled={saving} className="flex-1 bg-amber-500 text-white py-2.5 rounded-xl hover:bg-amber-600 font-medium disabled:opacity-50">
              {saving?'Kaydediliyor...':'Kaydet'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── PlayerModal ────────────────────────────────────
function PlayerModal({ player, teams, onSave, onClose }) {
  const teamOfPlayer = teams.find(t=>t.players.some(p=>p.id===player.id));
  const teamColor = teamOfPlayer?.color || '#999';
  const [name, setName] = useState(player.name||'');
  const [rank, setRank] = useState(player.rank||'B');
  const [photo, setPhoto] = useState(player.photo||'');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();

  async function handleFile(e) {
    const file = e.target.files?.[0]; if(!file) return;
    setPhoto(await compressImage(file));
  }
  async function handleSave() {
    if(!name.trim()) return;
    setSaving(true);
    await onSave({...player, name:name.trim(), rank, photo});
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">Oyuncu Düzenle</h3>
          <div className="flex flex-col items-center mb-5">
            <div className="relative cursor-pointer" onClick={()=>fileRef.current?.click()}>
              {photo?<img src={photo} className="w-24 h-24 rounded-full object-cover border-4 border-amber-200"/>:<div className="w-24 h-24 rounded-full flex items-center justify-center text-white text-4xl font-bold border-4 border-amber-200" style={{background:teamColor}}>{(name||'?')[0]}</div>}
              <div className="absolute bottom-1 right-1 bg-amber-500 text-white rounded-full w-7 h-7 flex items-center justify-center shadow">📷</div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile}/>
            <span className="text-xs text-gray-400 mt-2">Fotoğraf eklemek için tıkla</span>
          </div>
          <div className="space-y-4">
            <div><label className="text-sm font-medium text-gray-600 block mb-1">Ad Soyad</label>
              <input value={name} onChange={e=>setName(e.target.value)} className="border rounded-xl px-3 py-2 w-full text-sm focus:border-amber-400 focus:outline-none"/></div>
            <div><label className="text-sm font-medium text-gray-600 block mb-1">Klasman</label>
              <div className="flex gap-2">{RANKS.map(r=>(
                <button key={r} onClick={()=>setRank(r)} className={`flex-1 py-2 rounded-xl text-sm font-bold border-2 transition-all ${rank===r?'border-amber-500 bg-amber-50 text-amber-700':'border-gray-200 text-gray-400 hover:border-gray-300'}`}>{r}</button>
              ))}</div>
            </div>
          </div>
          <div className="flex gap-3 mt-5">
            <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl hover:bg-gray-50">İptal</button>
            <button onClick={handleSave} disabled={saving} className="flex-1 bg-amber-500 text-white py-2.5 rounded-xl hover:bg-amber-600 font-medium disabled:opacity-50">{saving?'Kaydediliyor...':'Kaydet'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── TeamModal ──────────────────────────────────────
function TeamModal({ team, onSave, onClose }) {
  const [name, setName] = useState(team.name||'');
  const [color, setColor] = useState(team.color||'#333333');
  const [logo, setLogo] = useState(team.logo||'');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();

  async function handleFile(e) {
    const file = e.target.files?.[0]; if(!file) return;
    setLogo(await compressImage(file));
  }
  async function handleSave() {
    if(!name.trim()) return;
    setSaving(true);
    await onSave({...team, name:name.trim(), color, logo});
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">Takım Düzenle</h3>
          <div className="flex flex-col items-center mb-5">
            <div className="relative cursor-pointer" onClick={()=>fileRef.current?.click()}>
              {logo?<img src={logo} className="w-24 h-24 rounded-full object-cover border-4 border-blue-200"/>:<div className="w-24 h-24 rounded-full flex items-center justify-center text-white text-4xl border-4 border-blue-200 shadow-inner" style={{background:color}}>🏅</div>}
              <div className="absolute bottom-1 right-1 bg-blue-500 text-white rounded-full w-7 h-7 flex items-center justify-center shadow">📷</div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile}/>
          </div>
          <div className="space-y-4">
            <div><label className="text-sm font-medium text-gray-600 block mb-1">Takım Adı</label>
              <input value={name} onChange={e=>setName(e.target.value)} className="border rounded-xl px-3 py-2 w-full text-sm focus:border-blue-400 focus:outline-none"/></div>
            <div><label className="text-sm font-medium text-gray-600 block mb-1">Renk</label>
              <div className="flex items-center gap-3">
                <input type="color" value={color} onChange={e=>setColor(e.target.value)} className="w-12 h-10 rounded-lg cursor-pointer border border-gray-200"/>
                <span className="text-sm text-gray-500 font-mono">{color}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-3 mt-5">
            <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl hover:bg-gray-50">İptal</button>
            <button onClick={handleSave} disabled={saving} className="flex-1 bg-blue-500 text-white py-2.5 rounded-xl hover:bg-blue-600 font-medium disabled:opacity-50">{saving?'Kaydediliyor...':'Kaydet'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── AddPlayerModal ─────────────────────────────────
function AddPlayerModal({ teamId, onSave, onClose }) {
  const [name, setName] = useState('');
  const [rank, setRank] = useState('B');
  const [photo, setPhoto] = useState('');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();

  async function handleFile(e) {
    const file = e.target.files?.[0]; if(!file) return;
    setPhoto(await compressImage(file));
  }
  async function handleSave() {
    if(!name.trim()) return;
    setSaving(true);
    await onSave(teamId, { name:name.trim(), rank, photo });
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">Oyuncu Ekle</h3>
          <div className="flex flex-col items-center mb-5">
            <div className="relative cursor-pointer" onClick={()=>fileRef.current?.click()}>
              {photo?<img src={photo} className="w-24 h-24 rounded-full object-cover border-4 border-amber-200"/>:<div className="w-24 h-24 rounded-full bg-amber-100 flex items-center justify-center text-amber-400 text-5xl border-4 border-dashed border-amber-300">+</div>}
              <div className="absolute bottom-1 right-1 bg-amber-500 text-white rounded-full w-7 h-7 flex items-center justify-center shadow">📷</div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile}/>
          </div>
          <div className="space-y-4">
            <div><label className="text-sm font-medium text-gray-600 block mb-1">Ad Soyad</label>
              <input value={name} onChange={e=>setName(e.target.value)} placeholder="Oyuncu adı" className="border rounded-xl px-3 py-2 w-full text-sm focus:border-amber-400 focus:outline-none"/></div>
            <div><label className="text-sm font-medium text-gray-600 block mb-1">Klasman</label>
              <div className="flex gap-2">{RANKS.map(r=>(
                <button key={r} onClick={()=>setRank(r)} className={`flex-1 py-2 rounded-xl text-sm font-bold border-2 transition-all ${rank===r?'border-amber-500 bg-amber-50 text-amber-700':'border-gray-200 text-gray-400 hover:border-gray-300'}`}>{r}</button>
              ))}</div>
            </div>
          </div>
          <div className="flex gap-3 mt-5">
            <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl hover:bg-gray-50">İptal</button>
            <button onClick={handleSave} disabled={saving} className="flex-1 bg-amber-500 text-white py-2.5 rounded-xl hover:bg-amber-600 font-medium disabled:opacity-50">{saving?'Ekleniyor...':'Ekle'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
