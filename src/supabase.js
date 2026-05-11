import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey && supabaseUrl.startsWith('https://'));

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      realtime: { params: { eventsPerSecond: 10 } }
    })
  : null;

// ─── Teams ──────────────────────────────────────────
export async function dbGetTeams() {
  if (!supabase) return null;
  const { data, error } = await supabase.from('teams').select('*').order('created_at');
  if (error) throw error;
  return data;
}

export async function dbUpsertTeam(team) {
  if (!supabase) return;
  const { error } = await supabase.from('teams').upsert({
    id: team.id, name: team.name, color: team.color, logo: team.logo || ''
  });
  if (error) throw error;
}

export async function dbDeleteTeam(teamId) {
  if (!supabase) return;
  const { error } = await supabase.from('teams').delete().eq('id', teamId);
  if (error) throw error;
}

// ─── Players ────────────────────────────────────────
export async function dbGetPlayers() {
  if (!supabase) return null;
  const { data, error } = await supabase.from('players').select('*').order('display_order');
  if (error) throw error;
  return data;
}

export async function dbUpsertPlayer(player) {
  if (!supabase) return;
  const { error } = await supabase.from('players').upsert({
    id: player.id,
    team_id: player.teamId,
    name: player.name,
    photo: player.photo || '',
    rank: player.rank || 'B',
    display_order: player.displayOrder || 0
  });
  if (error) throw error;
}

export async function dbDeletePlayer(playerId) {
  if (!supabase) return;
  const { error } = await supabase.from('players').delete().eq('id', playerId);
  if (error) throw error;
}

// ─── Matches ────────────────────────────────────────
export async function dbGetMatches() {
  if (!supabase) return null;
  const { data, error } = await supabase.from('matches').select('*');
  if (error) throw error;
  return data;
}

export async function dbUpsertMatch(match) {
  if (!supabase) return;
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
    played: match.played || false
  });
  if (error) throw error;
}

export async function dbInsertMatches(matchList) {
  if (!supabase) return;
  const rows = matchList.map(m => ({
    id: m.id,
    team_a_id: m.teamAId,
    team_b_id: m.teamBId,
    player_a_id: m.playerAId,
    player_b_id: m.playerBId,
    sets: m.sets || [],
    sets_a: m.setA || 0,
    sets_b: m.setB || 0,
    points_a: m.pointsA || 0,
    points_b: m.pointsB || 0,
    played: false
  }));
  // Insert in chunks of 100
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabase.from('matches').insert(rows.slice(i, i + 100));
    if (error) throw error;
  }
}

export async function dbDeleteAllMatches() {
  if (!supabase) return;
  // Delete all rows - use a filter that matches everything
  const { error } = await supabase.from('matches').delete().gte('sets_a', -1);
  if (error) {
    // fallback: delete where played is true or false
    const { error: e2 } = await supabase.from('matches').delete().not('id', 'is', null);
    if (e2) throw e2;
  }
}

export async function dbResetMatchResults() {
  if (!supabase) return;
  const { error } = await supabase.from('matches').update({
    sets: [], sets_a: 0, sets_b: 0, points_a: 0, points_b: 0, played: false
  }).not('id', 'is', null);
  if (error) throw error;
}

// ─── Realtime subscription ──────────────────────────
export function subscribeToChanges(onTeams, onPlayers, onMatches) {
  if (!supabase) return () => {};
  const channel = supabase
    .channel('db-all-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, onTeams)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, onPlayers)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, onMatches)
    .subscribe();
  return () => supabase.removeChannel(channel);
}
// v2 - Supabase realtime enabled
