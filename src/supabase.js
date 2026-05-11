import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Supabase credentials check
const isConfigured = supabaseUrl && supabaseAnonKey && supabaseUrl.startsWith('https://');

export const supabase = isConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export const isSupabaseConfigured = isConfigured;

export async function fetchAllData() {
  if (!supabase) {
    // Return demo data when Supabase is not configured
    return {
      teams: [
        { id: 'fb', name: 'Fenerbahçe', color: '#003399', logo: '', players: [
          { id: 'fb1', name: 'Şenol', photo: '' },
          { id: 'fb2', name: 'Fatih', photo: '' },
          { id: 'fb3', name: 'Samet', photo: '' },
          { id: 'fb4', name: 'Gökhan', photo: '' },
          { id: 'fb5', name: 'Can', photo: '' },
          { id: 'fb6', name: 'Süleyman', photo: '' },
          { id: 'fb7', name: 'Burak', photo: '' },
        ]},
        { id: 'gs', name: 'Galatasaray', color: '#CC0000', logo: '', players: [
          { id: 'gs1', name: 'Güven', photo: '' },
          { id: 'gs2', name: 'Emre Y.', photo: '' },
          { id: 'gs3', name: 'Uğur', photo: '' },
          { id: 'gs4', name: 'Erdinç', photo: '' },
          { id: 'gs5', name: 'Emre M.', photo: '' },
          { id: 'gs6', name: 'Çağatay', photo: '' },
          { id: 'gs7', name: 'Mehmet', photo: '' },
        ]},
        { id: 'bjk', name: 'Beşiktaş', color: '#000000', logo: '', players: [
          { id: 'bjk1', name: 'Erhan', photo: '' },
          { id: 'bjk2', name: 'Cemal', photo: '' },
          { id: 'bjk3', name: 'Okan', photo: '' },
          { id: 'bjk4', name: 'Mert', photo: '' },
          { id: 'bjk5', name: 'Öner', photo: '' },
          { id: 'bjk6', name: 'Mustafa', photo: '' },
          { id: 'bjk7', name: 'Kadir', photo: '' },
          { id: 'bjk8', name: 'Salih', photo: '' },
        ]},
      ],
      matches: []
    };
  }

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
    sets: m.sets || [], setA: m.sets_a || 0, setB: m.sets_b || 0,
    pointsA: m.points_a || 0, pointsB: m.points_b || 0, played: m.played || false,
  }));
  return { teams, matches };
}

export async function upsertTeam(team) {
  if (!supabase) throw new Error('Supabase not configured');
  const { error: teamError } = await supabase.from('teams').upsert({
    id: team.id, name: team.name, color: team.color, logo: team.logo || '',
  });
  if (teamError) throw teamError;
  await supabase.from('players').delete().eq('team_id', team.id);
  if (team.players && team.players.length > 0) {
    const { error: playersError } = await supabase.from('players').insert(
      team.players.map((p, i) => ({
        id: p.id, team_id: team.id, name: p.name,
        photo: p.photo || '', display_order: i,
      }))
    );
    if (playersError) throw playersError;
  }
}

export async function deleteTeam(teamId) {
  if (!supabase) throw new Error('Supabase not configured');
  await supabase.from('players').delete().eq('team_id', teamId);
  const { error } = await supabase.from('teams').delete().eq('id', teamId);
  if (error) throw error;
}

export async function updatePlayerPhoto(playerId, photoUrl) {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.from('players').update({ photo: photoUrl }).eq('id', playerId);
  if (error) throw error;
}

export async function upsertMatch(match) {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.from('matches').upsert({
    id: match.id,
    team_a_id: match.teamAId,
    team_b_id: match.teamBId,
    player_a_id: match.playerAId,
    player_b_id: match.playerBId,
    sets: match.sets || [],
    sets_a: match.setA || 0,
    sets_b: match.setB || 0,
    points_a: match.pointsA || 0,
    points_b: match.pointsB || 0,
    played: match.played || false,
  });
  if (error) throw error;
}

export async function regenerateFixtures(teams) {
  if (!supabase) throw new Error('Supabase not configured');
  await supabase.from('matches').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  const matches = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const teamA = teams[i];
      const teamB = teams[j];
      for (const playerA of teamA.players) {
        for (const playerB of teamB.players) {
          matches.push({
            team_a_id: teamA.id, team_b_id: teamB.id,
            player_a_id: playerA.id, player_b_id: playerB.id,
            sets: [], sets_a: 0, sets_b: 0,
            points_a: 0, points_b: 0, played: false,
          });
        }
      }
    }
  }
  if (matches.length > 0) {
    const chunkSize = 100;
    for (let i = 0; i < matches.length; i += chunkSize) {
      const chunk = matches.slice(i, i + chunkSize);
      const { error } = await supabase.from('matches').insert(chunk);
      if (error) throw error;
    }
  }
}

export async function resetMatch(matchId) {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.from('matches').update({
    sets: [], sets_a: 0, sets_b: 0, points_a: 0, points_b: 0, played: false,
  }).eq('id', matchId);
  if (error) throw error;
}

export async function resetAll() {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.from('matches').update({
    sets: [], sets_a: 0, sets_b: 0, points_a: 0, points_b: 0, played: false,
  }).neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) throw error;
}

export async function uploadPhoto(file, path) {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.storage.from('photos').upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from('photos').getPublicUrl(path);
  return data.publicUrl;
}

async function compressImage(file, maxWidth = 400, quality = 0.7) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ratio = Math.min(maxWidth / img.width, 1);
        canvas.width = img.width * ratio;
        canvas.height = img.height * ratio;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => resolve(new File([blob], file.name, { type: 'image/jpeg' })),
          'image/jpeg', quality
        );
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export async function onload(playerId, file) {
  if (!supabase) throw new Error('Supabase not configured');
  const compressed = await compressImage(file);
  const path = `players/${playerId}_${Date.now()}.jpg`;
  const url = await uploadPhoto(compressed, path);
  await updatePlayerPhoto(playerId, url);
  return url;
}

export function subscribeToChanges(callback) {
  if (!supabase) return () => {};
  const channel = supabase
    .channel('db-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, callback)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, callback)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, callback)
    .subscribe();
  return () => supabase.removeChannel(channel);
}
