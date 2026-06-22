const axios = require('axios');
const Parser = require('rss-parser');
const parser = new Parser();

let cachedSportsData = { en: null, fr: null };
let lastFetchTime = { en: 0, fr: 0 };
const CACHE_DURATION_MS = 2 * 60 * 1000; // Cache for 2 minutes

const fetchSportsData = async (lang) => {
  const apiKey = process.env.SPORTS_API_KEY;
  let items = [];

  // 1. Fetch Football-Data.org Match Stats (World Cup, CL, PL, etc.)
  if (apiKey) {
    try {
      const headers = { 'X-Auth-Token': apiKey };
      
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
  }

  // 2. Fetch Live General News via RSS (World + Cameroon)
  try {
    // Google News RSS for World News
    const worldRssUrl = lang === 'fr' 
      ? 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=fr&gl=FR&ceid=FR:fr'
      : 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en';

    // Google News RSS for Cameroon General News
    const cameroonRssUrl = lang === 'fr'
      ? 'https://news.google.com/rss/search?q=Cameroun&hl=fr&gl=FR&ceid=FR:fr'
      : 'https://news.google.com/rss/search?q=Cameroon&hl=en-US&gl=US&ceid=US:en';

    const [worldFeed, camFeed] = await Promise.all([
      parser.parseURL(worldRssUrl).catch(() => ({ items: [] })),
      parser.parseURL(cameroonRssUrl).catch(() => ({ items: [] }))
    ]);
    
    // Take 4 world news items and 4 Cameroon news items
    const newsItems = [
      ...worldFeed.items.slice(0, 4).map(i => ({ ...i, source: 'World' })),
      ...camFeed.items.slice(0, 4).map(i => ({ ...i, source: 'CMR' }))
    ];

    // Shuffle them so they mix nicely
    const shuffledNews = newsItems.sort(() => 0.5 - Math.random());

    shuffledNews.forEach(item => {
      // Clean up Google News title (usually "Article Title - Source Name")
      let title = item.title;
      if (title.lastIndexOf(' - ') !== -1) {
        title = title.substring(0, title.lastIndexOf(' - '));
      }
      
      const prefix = item.source === 'CMR' ? '🇨🇲' : '🌍';
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
    const now = Date.now();
    
    if (!cachedSportsData[lang] || (now - lastFetchTime[lang] > CACHE_DURATION_MS)) {
      cachedSportsData[lang] = await fetchSportsData(lang);
      lastFetchTime[lang] = now;
    }

    res.status(200).json({
      success: true,
      data: {
        items: cachedSportsData[lang]
      }
    });
  } catch (error) {
    console.error('[SportsController] getTickerData error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching sports data' });
  }
};
