const axios = require('axios');
const Parser = require('rss-parser');
const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  }
});

let cachedSportsData = {};
let lastFetchTime = {};
let isFetching = {};
const CACHE_DURATION_MS = 2 * 60 * 1000; // Cache for 2 minutes

const fetchSportsData = async (lang, country = 'Cameroon') => {
  const apiKey = process.env.SPORTS_API_KEY;
  let items = [];

  // 1. Fetch Football-Data.org Match Stats (World Cup, CL, PL, etc.)
  if (apiKey) {
    const headers = { 'X-Auth-Token': apiKey };

    try {
      // Calculate dates for yesterday and tomorrow to get a wider range of matches
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const dateFrom = yesterday.toISOString().split('T')[0];
      const dateTo = tomorrow.toISOString().split('T')[0];

      // Fetch matches from yesterday to tomorrow
      const matchesRes = await axios.get(`https://api.football-data.org/v4/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`, { headers });
      const matches = matchesRes.data.matches || [];

      // Process Recent / Live Matches (Finished or in-play)
      const recentMatches = matches
        .filter(m => m.status === 'FINISHED' || m.status === 'IN_PLAY' || m.status === 'PAUSED')
        .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
        .slice(0, 8); // Show up to 8 recent/live matches

      recentMatches.forEach(m => {
        items.push({
          type: 'MATCH',
          status: m.status === 'IN_PLAY' ? 'LIVE' : 'FINISHED',
          home: m.homeTeam?.tla || m.homeTeam?.name || 'TBD',
          away: m.awayTeam?.tla || m.awayTeam?.name || 'TBD',
          homeScore: m.score?.fullTime?.home ?? 0,
          awayScore: m.score?.fullTime?.away ?? 0
        });
      });

      // Process Upcoming Matches
      const upcomingMatches = matches
        .filter(m => m.status === 'TIMED' || m.status === 'SCHEDULED')
        .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
        .slice(0, 5); // Show up to 5 upcoming matches

      upcomingMatches.forEach(m => {
        items.push({
          type: 'UPCOMING',
          home: m.homeTeam?.tla || m.homeTeam?.name || 'TBD',
          away: m.awayTeam?.tla || m.awayTeam?.name || 'TBD',
          time: m.utcDate
        });
      });
    } catch (error) {
      console.error('[SportsController] Error fetching matches:', error.message);
    }

    // 1.5 Fetch World Cup Match Data to Determine Active Stage and Qualified Teams
    let activeStage = 'GROUP_STAGE';
    let activeStagePriority = 1;
    let wcMatches = [];

    const stagePriority = {
      'GROUP_STAGE': 1,
      'ROUND_OF_32': 2,
      'LAST_32': 2,
      'ROUND_OF_16': 3,
      'LAST_16': 3,
      'QUARTER_FINALS': 4,
      'SEMI_FINALS': 5,
      'THIRD_PLACE': 6,
      'FINAL': 7
    };

    try {
      const wcMatchesRes = await axios.get('https://api.football-data.org/v4/competitions/WC/matches', { headers });
      wcMatches = wcMatchesRes.data?.matches || [];

      wcMatches.forEach(m => {
        const p = stagePriority[m.stage] || 0;
        if (p > activeStagePriority) {
          activeStage = m.stage;
          activeStagePriority = p;
        }
      });
    } catch (err) {
      console.error('[SportsController] Error fetching WC matches list:', err.message);
    }

    // Process World Cup info based on active tournament stage
    if (activeStagePriority > 1) {
      // Knockout stage logic: find teams active in this round
      try {
        const stageMatches = wcMatches.filter(m => m.stage === activeStage);
        let stageTeams = [];
        stageMatches.forEach(m => {
          if (m.homeTeam?.shortName || m.homeTeam?.name) stageTeams.push(m.homeTeam.shortName || m.homeTeam.name);
          if (m.awayTeam?.shortName || m.awayTeam?.name) stageTeams.push(m.awayTeam.shortName || m.awayTeam.name);
        });
        const uniqueStageTeams = [...new Set(stageTeams)];

        let stageLabel = activeStage.replace(/_/g, ' ');
        if (activeStage === 'LAST_32' || activeStage === 'ROUND_OF_32') stageLabel = 'Round of 32';
        if (activeStage === 'LAST_16' || activeStage === 'ROUND_OF_16') stageLabel = 'Round of 16';
        if (activeStage === 'QUARTER_FINALS') stageLabel = 'Quarter-Finals';
        if (activeStage === 'SEMI_FINALS') stageLabel = 'Semi-Finals';
        if (activeStage === 'FINAL') stageLabel = 'Finals';

        if (uniqueStageTeams.length > 0) {
          items.push({
            type: 'NEWS',
            title: lang === 'fr'
              ? `Mondial ${stageLabel}: ${uniqueStageTeams.slice(0, 8).join(', ')}`
              : `World Cup ${stageLabel} Teams: ${uniqueStageTeams.slice(0, 8).join(', ')}`,
            prefix: '⭐'
          });
        }

        // Check if the final has finished to crown the champion
        const finalMatch = wcMatches.find(m => m.stage === 'FINAL' && m.status === 'FINISHED');
        if (finalMatch && finalMatch.score?.winner) {
          const winner = finalMatch.score.winner === 'HOME_TEAM' ? finalMatch.homeTeam : finalMatch.awayTeam;
          const winnerName = winner?.shortName || winner?.name || 'TBD';
          items.push({
            type: 'NEWS',
            title: lang === 'fr'
              ? `👑 CHAMPION DU MONDE 2026: ${winnerName.toUpperCase()} ! 🎉`
              : `👑 WORLD CUP 2026 CHAMPIONS: ${winnerName.toUpperCase()}! 🎉`,
            prefix: '🏆'
          });
        }
      } catch (err) {
        console.error('[SportsController] Error processing WC knockout stage:', err.message);
      }
    } else {
      // Group stage logic: fetch standings & calculate qualified teams
      try {
        const wcStandingsRes = await axios.get('https://api.football-data.org/v4/competitions/WC/standings', { headers });
        const standings = wcStandingsRes.data?.standings || [];
        
        // Show standings of the first 4 groups
        const groupsToShow = standings.filter(s => s.type === 'TOTAL').slice(0, 4);
        groupsToShow.forEach(group => {
          const groupName = group.group ? group.group.replace('GROUP_', 'Group ') : 'Table';
          const teams = group.table.slice(0, 2).map(t => `${t.position}. ${t.team?.tla || t.team?.shortName || t.team?.name} (${t.points} pts)`).join(' | ');
          items.push({
            type: 'NEWS',
            title: lang === 'fr' ? `Mondial ${groupName}: ${teams}` : `World Cup ${groupName}: ${teams}`,
            prefix: '🏆'
          });
        });

        // Calculate currently qualified teams
        let qualified = [];
        standings.filter(s => s.type === 'TOTAL').forEach(group => {
          group.table.slice(0, 2).forEach(t => {
            if (t.playedGames === 3) {
              qualified.push(t.team?.shortName || t.team?.name);
            }
          });
        });

        if (qualified.length > 0) {
          const uniqueQualifiers = [...new Set(qualified)].slice(0, 8).join(', ');
          items.push({
            type: 'NEWS',
            title: lang === 'fr'
              ? `Qualifiés Mondial (16es): ${uniqueQualifiers} qualifiés pour le tour suivant !`
              : `World Cup Qualified (Rd of 32): ${uniqueQualifiers} have qualified for the next stage!`,
            prefix: '⭐'
          });
        }
      } catch (err) {
        console.error('[SportsController] Error fetching WC standings:', err.message);
      }
    }

    try {
      const wcScorersRes = await axios.get('https://api.football-data.org/v4/competitions/WC/scorers', { headers });
      const scorers = wcScorersRes.data?.scorers || [];
      if (scorers.length > 0) {
        const topScorers = scorers.slice(0, 5).map(s => `${s.player.name} (${s.goals} goals)`).join(' | ');
        items.push({
          type: 'NEWS',
          title: lang === 'fr' ? `Meilleurs Buteurs Mondial: ${topScorers}` : `World Cup Top Scorers: ${topScorers}`,
          prefix: '🔥'
        });
      }
    } catch (err) {
      console.error('[SportsController] Error fetching WC scorers:', err.message);
    }

  } else {
    // Return mock entries if API key is not configured
    items.push({
      type: 'NEWS',
      title: lang === 'fr'
        ? "Mondial Groupe A: 1. MEX (9 pts) | 2. RSA (4 pts)"
        : "World Cup Group A: 1. MEX (9 pts) | 2. RSA (4 pts)",
      prefix: '🏆'
    });
    items.push({
      type: 'NEWS',
      title: lang === 'fr'
        ? "Meilleurs Buteurs Mondial: Lionel Messi (5 buts) | Vinicius Junior (4 buts) | Kylian Mbappé (4 buts)"
        : "World Cup Top Scorers: Lionel Messi (5 goals) | Vinicius Junior (4 goals) | Kylian Mbappé (4 goals)",
      prefix: '🔥'
    });
    items.push({
      type: 'NEWS',
      title: lang === 'fr'
        ? "Qualifiés Mondial (16es): Mexique, Suisse, Canada, Argentine, Brésil, France, Angleterre, Pays-Bas"
        : "World Cup Qualified: Mexico, Switzerland, Canada, Argentina, Brazil, France, England, Netherlands",
      prefix: '⭐'
    });
  }

  // 2. Fetch Live General News via RSS (World + Country)
  try {
    // Google News RSS for World News
    const worldRssUrl = lang === 'fr' 
      ? 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=fr&gl=FR&ceid=FR:fr'
      : 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en';

    // Google News RSS for Country General News
    const queryTerm = country === 'Ivory Coast' ? "Côte d'Ivoire" : country;
    const countryRssUrl = lang === 'fr'
      ? `https://news.google.com/rss/search?q=${encodeURIComponent(queryTerm)}&hl=fr&gl=FR&ceid=FR:fr`
      : `https://news.google.com/rss/search?q=${encodeURIComponent(queryTerm)}&hl=en-US&gl=US&ceid=US:en`;

    const [worldFeed, countryFeed] = await Promise.all([
      parser.parseURL(worldRssUrl).catch(() => ({ items: [] })),
      parser.parseURL(countryRssUrl).catch(() => ({ items: [] }))
    ]);
    
    // Take 4 world news items and 4 country news items
    const newsItems = [
      ...worldFeed.items.slice(0, 4).map(i => ({ ...i, source: 'World' })),
      ...countryFeed.items.slice(0, 4).map(i => ({ ...i, source: 'Local' }))
    ];

    // Shuffle them so they mix nicely
    const shuffledNews = newsItems.sort(() => 0.5 - Math.random());

    shuffledNews.forEach(item => {
      // Clean up Google News title (usually "Article Title - Source Name")
      let title = item.title;
      if (title.lastIndexOf(' - ') !== -1) {
        title = title.substring(0, title.lastIndexOf(' - '));
      }
      
      const countryEmojis = {
        'Cameroon': '🇨🇲',
        'Kenya': '🇰🇪',
        'Ghana': '🇬🇭',
        'Ivory Coast': '🇨🇮',
        'Tanzania': '🇹🇿',
        'Egypt': '🇪🇬',
        'Nigeria': '🇳🇬'
      };
      const prefix = item.source === 'Local' ? (countryEmojis[country] || '📰') : '🌍';
      items.push({
        type: 'NEWS',
        title: title,
        prefix: prefix
      });
    });

  } catch (error) {
    console.error('[SportsController] Error fetching RSS news:', error.message);
  }

  return items;
};

exports.getTickerData = async (req, res) => {
  try {
    const lang = req.query.lang === 'fr' ? 'fr' : 'en';
    const country = req.query.country || 'Cameroon';
    const cacheKey = `${country}_${lang}`;
    const now = Date.now();
    
    if (!cachedSportsData[cacheKey] || (now - lastFetchTime[cacheKey] > CACHE_DURATION_MS)) {
      if (!isFetching[cacheKey]) {
        isFetching[cacheKey] = true;
        try {
          cachedSportsData[cacheKey] = await fetchSportsData(lang, country);
          lastFetchTime[cacheKey] = now;
        } finally {
          isFetching[cacheKey] = false;
        }
      }
    }

    res.status(200).json({
      success: true,
      data: {
        items: cachedSportsData[cacheKey] || []
      }
    });
  } catch (error) {
    console.error('[SportsController] getTickerData error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching sports data' });
  }
};
