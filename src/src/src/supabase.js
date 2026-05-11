import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('⚠️ .env dosyasında VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY tanımlı olmalı');
}

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
    id: m.id,
    teamAId: m.team_a_id,
    teamBId: m.team_b_id,
    playerAId: m.player_a_id,
    playerBId: m.player_b_id,
    sets: m.sets || [],
    setsA: m.sets_a || 0,
    setsB: m.sets_b || 0,
    pointsA: m.points_a || 0,
    pointsB: m.points_b || 0,
    played: m.played || false,
  }));

  return { teams, matches };
}

export async function upsertTeam(team) {
  const { error: teamError } = await supabase.from('teams').upsert({
    id: team.id,
    name: team.name,
    color: team.color,
    logo: team.logo || '',
  });
  if (teamError) throw teamError;

  await supabase.from('players').delete().eq('team_id', team.id);
  if (team.players && team.players.length > 0) {
    const { error: playersError } = await supabase.from('players').insert(
      team.players.map((p, idx) => ({
        id: p.id,
        team_id: team.id,
        name: p.name,
        photo: p.photo || '',
        display_order: idx,
      }))
    );
    if (playersError) throw playersError;
  }
}

export async function deleteTeam(teamId) {
  const { error } = await supabase.from('teams').delete().eq('id', teamId);
  if (error) throw error;
}

export async function updatePlayerPhoto(playerId, photo) {
  const { error } = await supabase.from('players').u
