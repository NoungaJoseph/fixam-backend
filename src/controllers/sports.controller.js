const axios = require('axios');

let cachedTickerText = null;
let lastFetchTime = null;
const CACHE_DURATION_MS = 2 * 60 * 1000; // Cache for 2 minutes

const fetchSportsData = async () => {
  const apiKey = process.env.SPORTS_API_KEY;
  if (!apiKey) return "🏆 Welcome to Fixam Sports! Add your API key to see live World Cup scores and standings.";

  try {
    const headers = { 'X-Auth-Token': apiKey };

    // Fetch World Cup Matches
    const matchesRes = await axios.get('https://api.football-data.org/v4/competitions/WC/matches', { headers });
    const matches = matchesRes.data.matches || [];

    // Fetch World Cup Standings
    const standingsRes = await axios.get('https://api.football-data.org/v4/competitions/WC/standings', { headers });
    const standings = standingsRes.data.standings || [];

    let tickerParts = [];

    // Process Recent / Live Matches (Last 5 finished or in-play)
    const recentMatches = matches
      .filter(m => m.status === 'FINISHED' || m.status === 'IN_PLAY' || m.status === 'PAUSED')
      .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
      .slice(0, 5);

    recentMatches.forEach(m => {
      const home = m.homeTeam?.tla || m.homeTeam?.name || 'TBD';
      const away = m.awayTeam?.tla || m.awayTeam?.name || 'TBD';
      const homeScore = m.score?.fullTime?.home ?? 0;
      const awayScore = m.score?.fullTime?.away ?? 0;
      const liveStatus = m.status === 'IN_PLAY' ? ' (LIVE)' : '';
      tickerParts.push(`⚽ ${home} ${homeScore} - ${awayScore} ${away}${liveStatus}`);
    });

    // Process Upcoming Matches (Next 3 scheduled)
    const upcomingMatches = matches
      .filter(m => m.status === 'TIMED' || m.status === 'SCHEDULED')
      .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
      .slice(0, 3);

    upcomingMatches.forEach(m => {
      const home = m.homeTeam?.tla || m.homeTeam?.name || 'TBD';
      const away = m.awayTeam?.tla || m.awayTeam?.name || 'TBD';
      const time = new Date(m.utcDate).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      tickerParts.push(`📅 Upcoming: ${home} vs ${away} (${time})`);
    });

    // Process Standings (First 2 teams of each group)
    const groupStandings = standings.filter(s => s.type === 'TOTAL');
    groupStandings.forEach(group => {
      const groupName = group.group ? group.group.replace('GROUP_', 'Group ') : 'Table';
      const teams = group.table.slice(0, 2).map(t => `${t.position}. ${t.team?.tla || t.team?.name}`).join(', ');
      tickerParts.push(`🏆 ${groupName}: ${teams}`);
    });

    if (tickerParts.length === 0) {
      return "🏆 Welcome to Fixam Sports! Waiting for World Cup match data...";
    }

    return tickerParts.join('  •  ');
  } catch (error) {
    console.error('[SportsController] Error fetching data:', error.message);
    return "⚠️ Fixam Sports: Unable to load latest World Cup data at this time. Please check back later.";
  }
};

exports.getTickerData = async (req, res) => {
  try {
    const now = Date.now();
    if (!cachedTickerText || !lastFetchTime || (now - lastFetchTime > CACHE_DURATION_MS)) {
      cachedTickerText = await fetchSportsData();
      lastFetchTime = now;
    }

    res.status(200).json({
      success: true,
      data: {
        tickerText: cachedTickerText
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error fetching sports data' });
  }
};
