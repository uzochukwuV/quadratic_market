/**
 * Football API Service
 * Fetches real-world football matches from external APIs
 * 
 * Primary: API-Football (api-football.com) - Free tier: 100 req/day
 * Fallback: Mock data for development
 */

import express, { Request, Response } from 'express';
import NodeCache from 'node-cache';

const router = express.Router();

// Cache for 5 minutes to reduce API calls
const cache = new NodeCache({ stdTTL: 300 });

// ─── Configuration ──────────────────────────────────────────────

const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY || '';
const FOOTBALL_API_BASE = 'https://v3.football.api-sports.io';

// ─── Types ────────────────────────────────────────────────────────

interface FootballMatch {
  id: number;
  date: string;
  timestamp: number;
  league: {
    id: number;
    name: string;
    country: string;
    logo: string;
  };
  homeTeam: {
    id: number;
    name: string;
    logo: string;
  };
  awayTeam: {
    id: number;
    name: string;
    logo: string;
  };
  status: 'upcoming' | 'live' | 'finished';
  score?: {
    home: number;
    away: number;
  };
}

interface FootballGroup {
  groupId: number;
  title: string;
  startTime: number;
  fixture: FootballMatch;
  markets: any[];
}

// ─── API-Football Response Types ──────────────────────────────────

interface ApiFootballFixture {
  fixture: {
    id: number;
    date: string;
    timestamp: number;
    status: {
      short: string;
      elapsed?: number;
    };
  };
  league: {
    id: number;
    name: string;
    country: string;
    logo: string;
  };
  teams: {
    home: { id: number; name: string; logo: string };
    away: { id: number; name: string; logo: string };
  };
  goals: {
    home: number | null;
    away: number | null;
  };
}

// ─── API Functions ────────────────────────────────────────────────

async function fetchFromApiFootball(date: string): Promise<FootballMatch[]> {
  if (!FOOTBALL_API_KEY) {
    console.log('No FOOTBALL_API_KEY set, using mock data');
    return getMockMatches();
  }

  try {
    const url = `${FOOTBALL_API_BASE}/fixtures?date=${date}`;
    const response = await fetch(url, {
      headers: {
        'x-apisports-key': FOOTBALL_API_KEY,
      },
    });

    if (!response.ok) {
      throw new Error(`API-Football error: ${response.status}`);
    }

    const data: any = await response.json();
    const fixtures: FootballMatch[] = [];

    for (const f of data.response || []) {
      fixtures.push(transformFixture(f));
    }

    return fixtures;
  } catch (error) {
    console.error('API-Football fetch failed:', error);
    return getMockMatches();
  }
}

function transformFixture(f: ApiFootballFixture): FootballMatch {
  const status = f.fixture.status.short;
  let matchStatus: 'upcoming' | 'live' | 'finished' = 'upcoming';
  
  if (status === 'LIVE' || status === '1H' || status === '2H' || status === 'HT') {
    matchStatus = 'live';
  } else if (status === 'FT' || status === 'AET' || status === 'PEN') {
    matchStatus = 'finished';
  }

  return {
    id: f.fixture.id,
    date: f.fixture.date,
    timestamp: f.fixture.timestamp,
    league: {
      id: f.league.id,
      name: f.league.name,
      country: f.league.country,
      logo: f.league.logo,
    },
    homeTeam: {
      id: f.teams.home.id,
      name: f.teams.home.name,
      logo: f.teams.home.logo,
    },
    awayTeam: {
      id: f.teams.away.id,
      name: f.teams.away.name,
      logo: f.teams.away.logo,
    },
    status: matchStatus,
    score: f.goals.home !== null ? {
      home: f.goals.home,
      away: f.goals.away!,
    } : undefined,
  };
}

// ─── Mock Data for Development ────────────────────────────────────

function getMockMatches(): FootballMatch[] {
  const now = new Date();
  const matches: FootballMatch[] = [
    {
      id: 1001,
      date: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      timestamp: Math.floor(now.getTime() / 1000) + 7200,
      league: { id: 39, name: 'Premier League', country: 'England', logo: 'https://media.api-sports.io/football/leagues/39.png' },
      homeTeam: { id: 50, name: 'Manchester City', logo: 'https://media.api-sports.io/football/teams/50.png' },
      awayTeam: { id: 33, name: 'Manchester United', logo: 'https://media.api-sports.io/football/teams/33.png' },
      status: 'upcoming',
    },
    {
      id: 1002,
      date: new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString(),
      timestamp: Math.floor(now.getTime() / 1000) + 14400,
      league: { id: 140, name: 'La Liga', country: 'Spain', logo: 'https://media.api-sports.io/football/leagues/140.png' },
      homeTeam: { id: 541, name: 'Real Madrid', logo: 'https://media.api-sports.io/football/teams/541.png' },
      awayTeam: { id: 548, name: 'Barcelona', logo: 'https://media.api-sports.io/football/teams/548.png' },
      status: 'upcoming',
    },
    {
      id: 1003,
      date: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
      timestamp: Math.floor(now.getTime() / 1000) + 21600,
      league: { id: 78, name: 'Bundesliga', country: 'Germany', logo: 'https://media.api-sports.io/football/leagues/78.png' },
      homeTeam: { id: 157, name: 'Bayern Munich', logo: 'https://media.api-sports.io/football/teams/157.png' },
      awayTeam: { id: 165, name: 'Borussia Dortmund', logo: 'https://media.api-sports.io/football/teams/165.png' },
      status: 'upcoming',
    },
    {
      id: 1004,
      date: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      timestamp: Math.floor(now.getTime() / 1000) + 86400,
      league: { id: 61, name: 'Ligue 1', country: 'France', logo: 'https://media.api-sports.io/football/leagues/61.png' },
      homeTeam: { id: 85, name: 'PSG', logo: 'https://media.api-sports.io/football/teams/85.png' },
      awayTeam: { id: 99, name: 'Olympique Marseille', logo: 'https://media.api-sports.io/football/teams/99.png' },
      status: 'upcoming',
    },
    {
      id: 1005,
      date: new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(),
      timestamp: Math.floor(now.getTime() / 1000) + 172800,
      league: { id: 2, name: 'UEFA Champions League', country: 'World', logo: 'https://media.api-sports.io/football/leagues/2.png' },
      homeTeam: { id: 157, name: 'Bayern Munich', logo: 'https://media.api-sports.io/football/teams/157.png' },
      awayTeam: { id: 541, name: 'Real Madrid', logo: 'https://media.api-sports.io/football/teams/541.png' },
      status: 'upcoming',
    },
  ];
  return matches;
}

// ─── Routes ──────────────────────────────────────────────────────

/**
 * GET /football/matches
 * Get matches for a specific date (YYYY-MM-DD)
 */
router.get('/matches', async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
    
    // Check cache
    const cacheKey = `matches_${date}`;
    const cached = cache.get<FootballMatch[]>(cacheKey);
    if (cached) {
      return res.json({ ok: true, source: 'cache', date, matches: cached });
    }

    const matches = await fetchFromApiFootball(date);
    
    // Cache results
    cache.set(cacheKey, matches);
    
    res.json({
      ok: true,
      source: FOOTBALL_API_KEY ? 'api-football' : 'mock',
      date,
      matches,
    });
  } catch (error: any) {
    console.error('Error fetching matches:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /football/leagues
 * Get available leagues
 */
router.get('/leagues', async (req: Request, res: Response) => {
  try {
    const cacheKey = 'leagues';
    const cached = cache.get<any[]>(cacheKey);
    if (cached) {
      return res.json({ ok: true, source: 'cache', leagues: cached });
    }

    if (!FOOTBALL_API_KEY) {
      // Return popular leagues
      const leagues = [
        { id: 39, name: 'Premier League', country: 'England', logo: 'https://media.api-sports.io/football/leagues/39.png' },
        { id: 140, name: 'La Liga', country: 'Spain', logo: 'https://media.api-sports.io/football/leagues/140.png' },
        { id: 78, name: 'Bundesliga', country: 'Germany', logo: 'https://media.api-sports.io/football/leagues/78.png' },
        { id: 135, name: 'Serie A', country: 'Italy', logo: 'https://media.api-sports.io/football/leagues/135.png' },
        { id: 61, name: 'Ligue 1', country: 'France', logo: 'https://media.api-sports.io/football/leagues/61.png' },
        { id: 2, name: 'UEFA Champions League', country: 'World', logo: 'https://media.api-sports.io/football/leagues/2.png' },
      ];
      return res.json({ ok: true, source: 'mock', leagues });
    }

    const url = `${FOOTBALL_API_BASE}/leagues`;
    const response = await fetch(url, {
      headers: { 'x-apisports-key': FOOTBALL_API_KEY },
    });

    const data: any = await response.json();
    const leagues = data.response?.map((l: any) => ({
      id: l.league.id,
      name: l.league.name,
      country: l.country?.name || 'Unknown',
      logo: l.league.logo,
    })) || [];

    cache.set(cacheKey, leagues);
    res.json({ ok: true, source: 'api-football', leagues });
  } catch (error: any) {
    console.error('Error fetching leagues:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /football/today
 * Get today's matches
 */
router.get('/today', async (req: Request, res: Response) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const cacheKey = `matches_${today}`;
    const cached = cache.get<FootballMatch[]>(cacheKey);
    if (cached) {
      return res.json({ ok: true, source: 'cache', date: today, matches: cached });
    }

    const matches = await fetchFromApiFootball(today);
    cache.set(cacheKey, matches);
    
    res.json({ ok: true, source: FOOTBALL_API_KEY ? 'api-football' : 'mock', date: today, matches });
  } catch (error: any) {
    console.error('Error fetching today matches:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
export { router as footballRouter, FootballMatch, FootballGroup };