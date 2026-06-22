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
      
      // Fetch today's matches for all competitions (or just WC if preferred, but we use matches endpoint)
      // The free tier /matches fetches today's matches across available competitions
      const matchesRes = await axios.get('https://api.football-data.org/v4/matches', { headers });
      const matches = matchesRes.data.matches || [];

      // Process Recent / Live Matches (Last 5 finished or in-play)
      const recentMatches = matches
        .filter(m => m.status === 'FINISHED' || m.status === 'IN_PLAY' || m.status === 'PAUSED')
        .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
        .slice(0, 5);

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

      // Process Upcoming Matches (Next 3 scheduled)
      const upcomingMatches = matches
        .filter(m => m.status === 'TIMED' || m.status === 'SCHEDULED')
        .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
        .slice(0, 3);

      upcomingMatches.forEach(m => {
        items.push({
          type: 'UPCOMING',
          home: m.homeTeam?.tla || m.homeTeam?.name || 'TBD',
          away: m.awayTeam?.tla || m.awayTeam?.name || 'TBD',
          time: m.utcDate // Frontend will format this
        });
      });
    } catch (error) {
      console.error('[SportsController] Error fetching matches:', error.message);
    }
  }

  // 2. Fetch Live Football News via RSS
  try {
    const rssUrl = lang === 'fr' 
      ? 'https://www.lequipe.fr/rss/actu_rss_Football.xml' // French News
      : 'http://feeds.bbci.co.uk/sport/football/rss.xml';   // English News

    const feed = await parser.parseURL(rssUrl);
    
    // Take the top 5 news headlines
    const newsItems = feed.items.slice(0, 5);
    newsItems.forEach(item => {
      items.push({
        type: 'NEWS',
        title: item.title
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
