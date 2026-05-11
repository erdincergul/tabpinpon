import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchAllData, upsertTeam, deleteTeam, updatePlayerPhoto,
  upsertMatch, regenerateFixtures, resetMatch, resetAll,
  uploadPhoto, subscribeToChanges
} from './supabase.js';

const ADMIN_PASSWORD = 'Admin2026Tab2026';

const INITIAL_TEAMS = [
  {
    id: 'fb', name: 'Fenerbahçe', color: '#003399', logo: '',
    players: [
      { id: 'fb1', name: 'Şenol', photo: '' }, { id: 'fb2', name: 'Fatih', photo: '' },
      { id: 'fb3', name: 'Samet', photo: '' }, { id: 'fb4', name: 'Gökhan', photo: '' },
      { id: 'fb5', name: 'Can', photo: '' }, { id: 'fb6', name: 'Süleyman', photo: '' },
      { id: 'fb7', name: 'Burak', photo: '' }
    ]
  },
  {
    id: 'gs', name: 'Galatasaray', color: '#CC0000', logo: '',
    players: [
      { id: 'gs1', name: 'Güven', photo: '' }, { id: 'gs2', name: 'Emre Y.', photo: '' },
      { id: 'gs3', name: 'Uğur', photo: '' }, { id: 'gs4', name: 'Erdinç', photo: '' },
      { id: 'gs5', name: 'Emre M.', photo: '' }, { id: 'gs6', name: 'Çağatay', photo: '' },
      { id: 'gs7', name: 'Mehmet', photo: '' }
    ]
  },
  {
    id: 'bjk', name: 'Beşiktaş', color: '#000000', logo: '',
    players: [
      { id: 'bjk1', name: 'Erhan', photo: '' }, { id: 'bjk2', name: 'Cemal', photo: '' },
      { id: 'bjk3', name: 'Okan', photo: '' }, { id: 'bjk4', name: 'Mert', photo: '' },
      { id: 'bjk5', name: 'Öner', photo: '' }, { id: 'bjk6', name: 'Mustafa', photo: '' },
      { id: 'bjk7', name: 'Kadir', photo: '' }, { id: 'bjk8', name: 'Salih', photo: '' }
    ]
  }
];

function generateFixtures(teams) {
  const matches = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const tA = teams[i], tB = teams[j];
      for (const pA of tA.players) {
        for (const pB of tB.players) {
          matches.push({
            id: `${pA.id}_vs_${pB.id}`,
            teamAId: tA.id, teamBId: tB.id,
            playerAId: pA.id, playerBId: pB.id,
            sets: [], setsA: 0, setsB: 0, pointsA: 0, pointsB: 0, played: false
          });
        }
      }
    }
  }
  return matches;
}

function computeStandings(teams, matches) {
  const stats = {};
  for (const t of teams) {
    stats[t.id] = { id: t.id, name: t.name, color: t.color, logo: t.logo,
      p: 0, w: 0, l: 0, pts: 0, setW: 0, setL: 0, ptW: 0, ptL: 0 };
  }
  for (const m of matches) {
    if (!m.played) continue;
    const a = stats[m.teamAId], b = stats[m.teamBId];
    if (!a || !b) continue;
    a.p++; b.p++;
    a.setW += m.setsA; a.setL += m.setsB;
    b.setW += m.setsB; b.setL += m.setsA;
    a.ptW += m.pointsA; a.ptL += m.pointsB;
    b.ptW += m.pointsB; b.ptL += m.pointsA;
    if (m.setsA > m.setsB) { a.w++; a.pts += 3; b.l++; }
    else { b.w++; b.pts += 3; a.l++; }
  }
  return Object.values(stats).sort((a, b) =>
    b.pts - a.pts || (b.setW - b.setL) - (a.setW - a.setL) || (b.ptW - b.ptL) - (a.ptW - a.ptL)
  );
}

function computePlayerStats(teams, matches) {
  const stats = {};
  for (const t of teams) {
    for (const p of t.players) {
      stats[p.id] = { ...p, teamId: t.id, teamName: t.name, teamColor: t.color,
        p: 0, w: 0, l: 0, setW: 0, setL: 0, ptW: 0, ptL: 0 };
    }
  }
  for (const m of matches) {
    if (!m.played) continue;
    const a = stats[m.playerAId], b = stats[m.playerBId];
    if (!a || !b) continue;
    a.p++; b.p++;
    a.setW += m.setsA; a.setL += m.setsB;
    b.setW += m.setsB; b.setL += m.setsA;
    a.ptW += m.pointsA; a.ptL += m.pointsB;
    b.ptW += m.pointsB; b.ptL += m.pointsA;
    if (m.setsA > m.setsB) { a.w++; b.l++; } else { b.w++; a.l++; }
  }
  return Object.values(stats).sort((a, b) => b.w - a.w || (b.ptW - b.ptL) - (a.ptW - a.ptL));
}

export default function App() {
  const [teams, setTeams] = useState([]);
  const [matches, setMatches] = useState([]);
  const [tab, setTab] = useState('standings');
  const [isAdmin, setIsAdmin] = useState(false);
  const [pwInput, setPwInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scoreModal, setScoreModal] = useState(null);
  const [sets, setSets] = useState([{ a: '', b: '' }]);
  const [filterTeam, setFilterTeam] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchPlayer, setSearchPlayer] = useState('');
  const [photoModal, setPhotoModal] = useState(null);
  const [uploading, setUploading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const data = await fetchAllData();
      setTeams(data.teams.length ? data.teams : INITIAL_TEAMS);
      setMatches(data.matches);
    } catch (e) {
      setError('Veri yüklenemedi: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const unsub = subscribeToChanges(loadData);
    return unsub;
  }, [loadData]);

  const handleLogin = () => {
    if (pwInput === ADMIN_PASSWORD) { setIsAdmin(true); setPwInput(''); setError(''); }
    else setError('Yanlış şifre');
  };

  const initFixtures = async () => {
    const fix = generateFixtures(teams);
    await regenerateFixtures(fix);
    await loadData();
  };

  const openScore = (m) => {
    setScoreModal(m);
    setSets(m.sets.length ? m.sets.map(s => ({ a: String(s[0]), b: String(s[1]) })) : [{ a: '', b: '' }]);
  };

  const saveScore = async () => {
    if (!scoreModal) return;
    const validSets = sets.filter(s => s.a !== '' && s.b !== '');
    if (validSets.length < 2) { alert('En az 2 set girilmeli'); return; }
    let sA = 0, sB = 0, pA = 0, pB = 0;
    const setsData = validSets.map(s => {
      const a = parseInt(s.a), b = parseInt(s.b);
      if (a > b) sA++; else sB++;
      pA += a; pB += b;
      return [a, b];
    });
    await upsertMatch({ ...scoreModal, sets: setsData, setsA: sA, setsB: sB, pointsA: pA, pointsB: pB, played: true });
    setScoreModal(null);
    await loadData();
  };

  const handlePhotoUpload = async (file, playerId) => {
    setUploading(true);
    try {
      const url = await uploadPhoto(file, 'player');
      await updatePlayerPhoto(playerId, url);
      await loadData();
    } catch (e) { alert('Fotoğraf yüklenemedi: ' + e.message); }
    finally { setUploading(false); setPhotoModal(null); }
  };

  const standings = computeStandings(teams, matches);
  const playerStats = computePlayerStats(teams, matches);
  const played = matches.filter(m => m.played).length;
  const total = matches.length;

  const filteredMatches = matches.filter(m => {
    if (filterTeam !== 'all' && m.teamAId !== filterTeam && m.teamBId !== filterTeam) return false;
    if (filterStatus === 'played' && !m.played) return false;
    if (filterStatus === 'pending' && m.played) return false;
    if (searchPlayer) {
      const allPlayers = teams.flatMap(t => t.players);
      const pA = allPlayers.find(p => p.id === m.playerAId);
      const pB = allPlayers.find(p => p.id === m.playerBId);
      const q = searchPlayer.toLowerCase();
      if (!pA?.name.toLowerCase().includes(q) && !pB?.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const getPlayer = (id) => teams.flatMap(t => t.players).find(p => p.id === id);
  const getTeam = (id) => teams.find(t => t.id === id);

  if (loading) return (
    <div className="min-h-screen bg-amber-50 flex items-center justify-center">
      <div className="text-center"><div className="text-4xl mb-4">🏓</div><p className="text-gray-600">Yükleniyor...</p></div>
    </div>
  );

  return (
    <div className="min-h-screen bg-amber-50">
      {/* Header */}
      <header className="bg-white border-b border-orange-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🏓</span>
            <div>
              <h1 className="font-bold text-gray-900 text-lg leading-tight">TabMuhasebe</h1>
              <p className="text-xs text-orange-600 font-medium">Pinpon Turnuvası</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {total > 0 && <span className="text-xs text-gray-500">{played}/{total} maç</span>}
            {!isAdmin ? (
              <div className="flex gap-1">
                <input type="password" value={pwInput} onChange={e => setPwInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLogin()}
                  placeholder="Admin şifresi" className="border rounded px-2 py-1 text-xs w-28" />
                <button onClick={handleLogin} className="bg-orange-500 text-white px-2 py-1 rounded text-xs hover:bg-orange-600">Giriş</button>
              </div>
            ) : (
              <div className="flex gap-1 items-center">
                <span className="text-xs text-green-600 font-medium">✓ Admin</span>
                <button onClick={() => setIsAdmin(false)} className="text-xs text-gray-400 hover:text-gray-600">Çıkış</button>
              </div>
            )}
          </div>
        </div>
        {error && <div className="bg-red-50 text-red-600 text-xs px-4 py-1 text-center">{error}</div>}
      </header>

      {/* Tabs */}
      <div className="bg-white border-b border-orange-100">
        <div className="max-w-5xl mx-auto px-4 flex gap-0 overflow-x-auto">
          {[['standings','Puan Durumu'],['matches','Maçlar'],['players','Oyuncular'],['teams','Kadrolar']].map(([k,v]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${tab === k ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {v}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Puan Durumu */}
        {tab === 'standings' && (
          <div>
            <h2 className="text-lg font-bold text-gray-800 mb-4">Puan Durumu</h2>
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-orange-50 text-gray-600 text-xs uppercase">
                    <th className="px-4 py-3 text-left">#</th>
                    <th className="px-4 py-3 text-left">Takım</th>
                    <th className="px-3 py-3 text-center">O</th>
                    <th className="px-3 py-3 text-center">G</th>
                    <th className="px-3 py-3 text-center">M</th>
                    <th className="px-3 py-3 text-center">SA</th>
                    <th className="px-3 py-3 text-center">SV</th>
                    <th className="px-3 py-3 text-center font-bold text-orange-600">P</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((s, i) => (
                    <tr key={s.id} className={`border-t ${i === 0 ? 'bg-yellow-50' : ''}`}>
                      <td className="px-4 py-3 font-bold text-gray-500">{i + 1}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                          {s.logo ? <img src={s.logo} alt="" className="w-6 h-6 object-contain" /> : null}
                          <span className="font-medium">{s.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center text-gray-600">{s.p}</td>
                      <td className="px-3 py-3 text-center text-green-600">{s.w}</td>
                      <td className="px-3 py-3 text-center text-red-500">{s.l}</td>
                      <td className="px-3 py-3 text-center">{s.setW}</td>
                      <td className="px-3 py-3 text-center">{s.setL}</td>
                      <td className="px-3 py-3 text-center font-bold text-orange-600 text-base">{s.pts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Maçlar */}
        {tab === 'matches' && (
          <div>
            <div className="flex flex-wrap gap-2 mb-4 items-center">
              <h2 className="text-lg font-bold text-gray-800 flex-1">Maçlar</h2>
              {isAdmin && total === 0 && (
                <button onClick={initFixtures} className="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-orange-600">
                  Fikstür Oluştur
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 mb-4">
              <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm bg-white">
                <option value="all">Tüm Takımlar</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm bg-white">
                <option value="all">Tümü</option>
                <option value="pending">Bekleyen</option>
                <option value="played">Oynanan</option>
              </select>
              <input value={searchPlayer} onChange={e => setSearchPlayer(e.target.value)}
                placeholder="Oyuncu ara..." className="border rounded-lg px-3 py-2 text-sm bg-white flex-1 min-w-32" />
            </div>
            <div className="space-y-2">
              {filteredMatches.map(m => {
                const pA = getPlayer(m.playerAId), pB = getPlayer(m.playerBId);
                const tA = getTeam(m.teamAId), tB = getTeam(m.teamBId);
                if (!pA || !pB || !tA || !tB) return null;
                return (
                  <div key={m.id} className={`bg-white rounded-xl shadow-sm p-4 flex items-center gap-3 ${m.played ? 'opacity-80' : ''}`}>
                    <div className="flex-1 flex items-center gap-2 min-w-0">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: tA.color }} />
                      {pA.photo && <img src={pA.photo} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />}
                      <span className="font-medium text-sm truncate">{pA.name}</span>
                    </div>
                    <div className="text-center flex-shrink-0 px-2">
                      {m.played ? (
                        <div>
                          <div className="font-bold text-lg">{m.setsA} - {m.setsB}</div>
                          <div className="text-xs text-gray-400">{m.sets?.map(s => s.join('-')).join(' ')}</div>
                        </div>
                      ) : <span className="text-gray-400 text-sm">vs</span>}
                    </div>
                    <div className="flex-1 flex items-center gap-2 justify-end min-w-0">
                      <span className="font-medium text-sm truncate">{pB.name}</span>
                      {pB.photo && <img src={pB.photo} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />}
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: tB.color }} />
                    </div>
                    {isAdmin && (
                      <button onClick={() => openScore(m)}
                        className="ml-2 bg-orange-500 text-white px-3 py-1 rounded-lg text-xs hover:bg-orange-600 flex-shrink-0">
                        {m.played ? 'Düzenle' : 'Skor Gir'}
                      </button>
                    )}
                  </div>
                );
              })}
              {filteredMatches.length === 0 && (
                <div className="text-center py-12 text-gray-400">
                  {total === 0 ? 'Fikstür henüz oluşturulmadı.' : 'Maç bulunamadı.'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Oyuncular */}
        {tab === 'players' && (
          <div>
            <h2 className="text-lg font-bold text-gray-800 mb-4">Oyuncu İstatistikleri</h2>
            {playerStats.length > 0 && (
              <div className="flex gap-4 mb-6">
                {playerStats.slice(0, 3).map((p, i) => (
                  <div key={p.id} className="flex-1 bg-white rounded-xl shadow-sm p-4 text-center">
                    <div className="text-2xl mb-1">{['🥇','🥈','🥉'][i]}</div>
                    {p.photo ? <img src={p.photo} alt="" className="w-12 h-12 rounded-full object-cover mx-auto mb-2" /> :
                      <div className="w-12 h-12 rounded-full mx-auto mb-2 flex items-center justify-center text-white font-bold text-lg"
                        style={{ backgroundColor: p.teamColor }}>{p.name[0]}</div>}
                    <div className="font-bold text-sm">{p.name}</div>
                    <div className="text-xs text-gray-500">{p.teamName}</div>
                    <div className="text-xl font-bold text-orange-500 mt-1">{p.w}G</div>
                  </div>
                ))}
              </div>
            )}
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-orange-50 text-gray-600 text-xs uppercase">
                    <th className="px-4 py-3 text-left">#</th>
                    <th className="px-4 py-3 text-left">Oyuncu</th>
                    <th className="px-3 py-3 text-center">O</th>
                    <th className="px-3 py-3 text-center">G</th>
                    <th className="px-3 py-3 text-center">M</th>
                  </tr>
                </thead>
                <tbody>
                  {playerStats.map((p, i) => (
                    <tr key={p.id} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-500 text-sm">{i + 1}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          {p.photo ? <img src={p.photo} alt="" className="w-7 h-7 rounded-full object-cover" /> :
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
                              style={{ backgroundColor: p.teamColor }}>{p.name[0]}</div>}
                          <div>
                            <div className="font-medium">{p.name}</div>
                            <div className="text-xs text-gray-400">{p.teamName}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">{p.p}</td>
                      <td className="px-3 py-2 text-center text-green-600 font-medium">{p.w}</td>
                      <td className="px-3 py-2 text-center text-red-500">{p.l}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Kadrolar */}
        {tab === 'teams' && (
          <div>
            <h2 className="text-lg font-bold text-gray-800 mb-4">Kadrolar</h2>
            <div className="grid gap-4 md:grid-cols-3">
              {teams.map(team => (
                <div key={team.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
                  <div className="p-4 text-white" style={{ backgroundColor: team.color }}>
                    <div className="flex items-center gap-3">
                      {team.logo ? <img src={team.logo} alt="" className="w-10 h-10 object-contain bg-white rounded-lg p-1" /> :
                        <div className="w-10 h-10 bg-white bg-opacity-20 rounded-lg flex items-center justify-center text-xl">
                          {team.name[0]}
                        </div>}
                      <div>
                        <div className="font-bold">{team.name}</div>
                        <div className="text-xs opacity-75">{team.players.length} oyuncu</div>
                      </div>
                    </div>
                  </div>
                  <div className="divide-y">
                    {team.players.map(p => (
                      <div key={p.id} className="px-4 py-2 flex items-center gap-3">
                        <button onClick={() => isAdmin && setPhotoModal(p)} className={`flex-shrink-0 ${isAdmin ? 'cursor-pointer hover:opacity-80' : ''}`}>
                          {p.photo ? <img src={p.photo} alt="" className="w-8 h-8 rounded-full object-cover" /> :
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
                              style={{ backgroundColor: team.color }}>{p.name[0]}</div>}
                        </button>
                        <span className="text-sm">{p.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Skor Modal */}
      {scoreModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-5">
              <h3 className="font-bold text-lg mb-1">Skor Gir</h3>
              {(() => {
                const pA = getPlayer(scoreModal.playerAId), pB = getPlayer(scoreModal.playerBId);
                const tA = getTeam(scoreModal.teamAId), tB = getTeam(scoreModal.teamBId);
                return <p className="text-sm text-gray-500 mb-4">
                  <span className="font-medium">{pA?.name}</span> ({tA?.name}) vs <span className="font-medium">{pB?.name}</span> ({tB?.name})
                </p>;
              })()}
              <div className="space-y-3">
                {sets.map((s, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-sm text-gray-500 w-12">Set {i + 1}</span>
                    <input type="number" min="0" max="30" value={s.a}
                      onChange={e => setSets(prev => prev.map((x, j) => j === i ? { ...x, a: e.target.value } : x))}
                      className="border rounded-lg px-3 py-2 w-16 text-center text-lg font-bold" />
                    <span className="text-gray-400">–</span>
                    <input type="number" min="0" max="30" value={s.b}
                      onChange={e => setSets(prev => prev.map((x, j) => j === i ? { ...x, b: e.target.value } : x))}
                      className="border rounded-lg px-3 py-2 w-16 text-center text-lg font-bold" />
                    {i > 0 && <button onClick={() => setSets(prev => prev.filter((_, j) => j !== i))}
                      className="text-red-400 hover:text-red-600 text-lg">×</button>}
                  </div>
                ))}
                {sets.length < 3 && (
                  <button onClick={() => setSets(prev => [...prev, { a: '', b: '' }])}
                    className="text-sm text-orange-500 hover:text-orange-700">+ Set Ekle</button>
                )}
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={() => setScoreModal(null)} className="flex-1 border border-gray-200 rounded-xl py-2 text-sm hover:bg-gray-50">İptal</button>
                {scoreModal.played && <button onClick={async () => { await resetMatch(scoreModal.id); setScoreModal(null); await loadData(); }}
                  className="border border-red-200 text-red-500 rounded-xl py-2 px-3 text-sm hover:bg-red-50">Sıfırla</button>}
                <button onClick={saveScore} className="flex-1 bg-orange-500 text-white rounded-xl py-2 text-sm font-medium hover:bg-orange-600">Kaydet</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fotoğraf Modal */}
      {photoModal && isAdmin && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
            <h3 className="font-bold mb-3">Fotoğraf Yükle - {photoModal.name}</h3>
            <input type="file" accept="image/*" onChange={e => e.target.files[0] && handlePhotoUpload(e.target.files[0], photoModal.id)}
              className="w-full text-sm" disabled={uploading} />
            {uploading && <p className="text-sm text-orange-500 mt-2">Yükleniyor...</p>}
            <button onClick={() => setPhotoModal(null)} className="mt-3 w-full border rounded-xl py-2 text-sm hover:bg-gray-50">Kapat</button>
          </div>
        </div>
      )}
    </div>
  );
}
