import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function fetchAllData() {
  const [teamsRes, playersRes, matchesRes] = await Promise.all([
    supabase.from('teams').select('*').order('created_at'),
    supabase.from('players').select('*').order('display_order'),
    supabase.from('matches').select('*'),
  ]);
  if (teamsRes.error) throw teamsRes.error;
  if (playersRes.error) throw playersRes.error;
  if (matchesRes.error) throw matchesRes.error;
  const teams = teamsRes.data.map((t) => ({
    ...t,
    players: playersRes.data
      .filter((p) => p.team_id === t.id)
      .map((p) => ({ id: p.id, name: p.name, photo: p.photo || '' })),
  }));
  const matches = matchesRes.data.map((m) => ({
    id: m.id, teamAId: m.team_a_id, teamBId: m.team_b_id,
    playerAId: m.player_a_id, playerBId: m.player_b_id,
    sets: m.sets || [], setsA: m.sets_a || 0, setsB: m.sets_b || 0,
    pointsA: m.points_a || 0, pointsB: m.points_b || 0, played: m.played || false,
  }));
  return { teams, matches };
}

export async function upsertTeam(team) {
  const { error: teamError } = await supabase.from('teams').upsert({
    id: team.id, name: team.name, color: team.color, logo: team.logo || '',
  });
  if (teamError) throw teamError;
  await supabase.from('players').delete().eq('team_id', team.id);
  if (team.players && team.players.length > 0) {
    const { error } = await supabase.from('players').insert(
      team.players.map((p, idx) => ({
        id: p.id, team_id: team.id, name: p.name, photo: p.photo || '', display_order: idx,
      }))
    );
    if (error) throw error;
  }
}

export async function deleteTeam(teamId) {
  const { error } = await supabase.from('teams').delete().eq('id', teamId);
  if (error) throw error;
}

export async function updatePlayerPhoto(playerId, photo) {
  const { error } = await supabase.from('players').update({ photo }).eq('id', playerId);
  if (error) throw error;
}

export async function upsertMatch(match) {
  const { error } = await supabase.from('matches').upsert({
    id: match.id, team_a_id: match.teamAId, team_b_id: match.teamBId,
    player_a_id: match.playerAId, player_b_id: match.playerBId,
    sets: match.sets || [], sets_a: match.setsA || 0, sets_b: match.setsB || 0,
    points_a: match.pointsA || 0, points_b: match.pointsB || 0,
    played: match.played || false, updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function regenerateFixtures(matches) {
  await supabase.from('matches').delete().neq('id', '___never___');
  if (matches.length === 0) return;
  const rows = matches.map((m) => ({
    id: m.id, team_a_id: m.teamAId, team_b_id: m.teamBId,
    player_a_id: m.playerAId, player_b_id: m.playerBId,
    sets: [], sets_a: 0, sets_b: 0, points_a: 0, points_b: 0, played: false,
  }));
  const chunkSize = 100;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from('matches').insert(chunk);
    if (error) throw error;
  }
}

export async function resetMatch(matchId) {
  const { error } = await supabase.from('matches').update({
    sets: [], sets_a: 0, sets_b: 0, points_a: 0, points_b: 0, played: false,
    updated_at: new Date().toISOString(),
  }).eq('id', matchId);
  if (error) throw error;
}

export async function resetAll() {
  await supabase.from('matches').delete().neq('id', '___never___');
  await supabase.from('players').delete().neq('id', '___never___');
  await supabase.from('teams').delete().neq('id', '___never___');
}

export async function uploadPhoto(file, prefix = 'photo', maxSize = 250) {
  const compressedBlob = await compressImage(file, maxSize);
  const fileName = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from('photos').upload(fileName, compressedBlob, {
    contentType: 'image/jpeg', upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from('photos').getPublicUrl(fileName);
  return data.publicUrl;
}

function compressImage(file, maxSize) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > height) {
          if (width > maxSize) { height = (height * maxSize) / width; width = maxSize; }
        } else {
          if (height > maxSize) { width = (width * maxSize) / height; height = maxSize; }
        }
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function subscribeToChanges(onChange) {
  const channel = supabase
    .channel('tournament-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}
