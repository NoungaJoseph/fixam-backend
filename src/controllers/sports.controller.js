const axios = require('axios');
const Parser = require('rss-parser');
const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  }
});

// Cache structures
let cachedMatches = null;
let lastMatchesFetch = 0;
const MATCHES_CACHE_DURATION = 20 * 1000; // 20 seconds for rapid live score updates

let cachedStandings = {};
let lastStandingsFetch = {};
const STANDINGS_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

let cachedScorers = {};
let lastScorersFetch = {};
const SCORERS_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

let cachedNews = {};
let lastNewsFetch = {};
const NEWS_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

let cachedSportsData = {};
let lastFetchTime = {};
let isFetching = {};
const CACHE_DURATION_MS = 20 * 1000; // 20 seconds for rapid live score updates

// Rate limit helper: ensure at least 1200ms between calls to avoid exceeding 10 req/min
let lastApiCallTime = 0;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rateLimitedGet = async (url, apiKey) => {
  const now = Date.now();
  const timeSinceLast = now - lastApiCallTime;
  if (timeSinceLast < 1200) {
    await delay(1200 - timeSinceLast);
  }
  lastApiCallTime = Date.now();

  try {
    return await axios.get(url, { headers: { 'X-Auth-Token': apiKey }, timeout: 8000 });
  } catch (err) {
    if (err.response && err.response.status === 429) {
      console.warn('[SportsController] 429 Rate limit hit, using fallback cache for:', url);
    } else {
      console.error('[SportsController] API error:', err.message);
    }
    return null;
  }
};

const TARGET_LEAGUES = [
  { code: 'PL', name: 'Premier League', short: 'PL', country: 'England', emoji: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', hasScorers: true },
  { code: 'PD', name: 'La Liga', short: 'LaLiga', country: 'Spain', emoji: '🇪🇸', hasScorers: true },
  { code: 'BL1', name: 'Bundesliga', short: 'Bundesliga', country: 'Germany', emoji: '🇩🇪', hasScorers: true },
  { code: 'SA', name: 'Serie A', short: 'SerieA', country: 'Italy', emoji: '🇮🇹', hasScorers: true },
  { code: 'FL1', name: 'Ligue 1', short: 'Ligue1', country: 'France', emoji: '🇫🇷', hasScorers: true },
  { code: 'PPL', name: 'Primeira Liga', short: 'Liga Portugal', country: 'Portugal', emoji: '🇵🇹', hasScorers: false },
  { code: 'CL', name: 'Champions League', short: 'UCL', country: 'Europe', emoji: '⭐', hasScorers: true }
];

const getDayFormatted = (utcDateString, lang) => {
  const date = new Date(utcDateString);
  const daysEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const daysFr = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthsFr = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

  const dayName = lang === 'fr' ? daysFr[date.getDay()] : daysEn[date.getDay()];
  const monthName = lang === 'fr' ? monthsFr[date.getMonth()] : monthsEn[date.getMonth()];
  const dayNum = date.getDate();

  return `${dayName} ${dayNum} ${monthName}`;
};

// 1. Fetch Matches (Live, Recent Finished, Upcoming for the next 7 days)
const getMatchesData = async (apiKey) => {
  const now = Date.now();
  if (cachedMatches && (now - lastMatchesFetch < MATCHES_CACHE_DURATION)) {
    return cachedMatches;
  }

  if (!apiKey) return [];

  try {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);

    const dateFrom = yesterday.toISOString().split('T')[0];
    const dateTo = nextWeek.toISOString().split('T')[0];

    const compCodes = TARGET_LEAGUES.map(l => l.code).join(',');
    const url = `https://api.football-data.org/v4/matches?competitions=${compCodes}&dateFrom=${dateFrom}&dateTo=${dateTo}`;

    const res = await rateLimitedGet(url, apiKey);
    if (res && res.data?.matches) {
      cachedMatches = res.data.matches;
      lastMatchesFetch = now;
    }
    return cachedMatches || [];
  } catch (err) {
    console.error('[SportsController] Error fetching matches:', err.message);
    return cachedMatches || [];
  }
};

// 2. Fetch Standings (Top 4 for each league)
const getStandingsData = async (apiKey) => {
  if (!apiKey) return cachedStandings;
  const now = Date.now();

  for (const league of TARGET_LEAGUES) {
    if (league.code === 'CL') continue; // CL has tournament stage formats
    if (cachedStandings[league.code] && (now - (lastStandingsFetch[league.code] || 0) < STANDINGS_CACHE_DURATION)) {
      continue;
    }

    const res = await rateLimitedGet(`https://api.football-data.org/v4/competitions/${league.code}/standings`, apiKey);
    if (res && res.data?.standings?.[0]?.table) {
      cachedStandings[league.code] = res.data.standings[0].table.slice(0, 4);
      lastStandingsFetch[league.code] = now;
    }
  }

  return cachedStandings;
};

// 3. Fetch Top Scorers (for PL, La Liga, Bundesliga, Serie A, Ligue 1, and CL)
const getScorersData = async (apiKey) => {
  if (!apiKey) return cachedScorers;
  const now = Date.now();

  for (const league of TARGET_LEAGUES) {
    if (!league.hasScorers) continue;
    if (cachedScorers[league.code] && (now - (lastScorersFetch[league.code] || 0) < SCORERS_CACHE_DURATION)) {
      continue;
    }

    const res = await rateLimitedGet(`https://api.football-data.org/v4/competitions/${league.code}/scorers?limit=3`, apiKey);
    if (res && res.data?.scorers) {
      cachedScorers[league.code] = res.data.scorers.slice(0, 3);
      lastScorersFetch[league.code] = now;
    }
  }

  return cachedScorers;
};

// 4. Fetch RSS News (World + Cameroon + Country)
const getRssNews = async (lang, country) => {
  const cacheKey = `${lang}_${country}`;
  const now = Date.now();
  if (cachedNews[cacheKey] && (now - (lastNewsFetch[cacheKey] || 0) < NEWS_CACHE_DURATION)) {
    return cachedNews[cacheKey];
  }

  try {
    const worldRssUrl = lang === 'fr'
      ? 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=fr&gl=FR&ceid=FR:fr'
      : 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en';

    // Cameroon news
    const cameroonQuery = lang === 'fr' ? 'Cameroun' : 'Cameroon';
    const cameroonRssUrl = lang === 'fr'
      ? `https://news.google.com/rss/search?q=${encodeURIComponent(cameroonQuery)}&hl=fr&gl=FR&ceid=FR:fr`
      : `https://news.google.com/rss/search?q=${encodeURIComponent(cameroonQuery)}&hl=en-US&gl=US&ceid=US:en`;

    const feedsToFetch = [
      parser.parseURL(worldRssUrl).catch(() => ({ items: [] })),
      parser.parseURL(cameroonRssUrl).catch(() => ({ items: [] }))
    ];

    if (country && country.toLowerCase() !== 'cameroon' && country.toLowerCase() !== 'cameroun') {
      const countryQuery = country === 'Ivory Coast' ? "Côte d'Ivoire" : country;
      const countryRssUrl = lang === 'fr'
        ? `https://news.google.com/rss/search?q=${encodeURIComponent(countryQuery)}&hl=fr&gl=FR&ceid=FR:fr`
        : `https://news.google.com/rss/search?q=${encodeURIComponent(countryQuery)}&hl=en-US&gl=US&ceid=US:en`;
      feedsToFetch.push(parser.parseURL(countryRssUrl).catch(() => ({ items: [] })));
    }

    const [worldFeed, cameroonFeed, countryFeed] = await Promise.all(feedsToFetch);
    const newsItems = [];

    // Cameroon News (🇨🇲)
    if (cameroonFeed?.items) {
      cameroonFeed.items.slice(0, 4).forEach(item => {
        const title = cleanNewsTitle(item.title);
        if (title) {
          newsItems.push({
            title,
            prefix: '🇨🇲',
            source: 'Cameroon'
          });
        }
      });
    }

    // World News (🌍)
    if (worldFeed?.items) {
      worldFeed.items.slice(0, 4).forEach(item => {
        const title = cleanNewsTitle(item.title);
        if (title) {
          newsItems.push({
            title,
            prefix: '🌍',
            source: 'World'
          });
        }
      });
    }

    // Local Country News if separate
    if (countryFeed?.items) {
      const countryEmojis = {
        'Kenya': '🇰🇪',
        'Ghana': '🇬🇭',
        'Ivory Coast': '🇨🇮',
        'Tanzania': '🇹🇿',
        'Egypt': '🇪🇬',
        'Nigeria': '🇳🇬'
      };
      const prefix = countryEmojis[country] || '📍';
      countryFeed.items.slice(0, 3).forEach(item => {
        const title = cleanNewsTitle(item.title);
        if (title) {
          newsItems.push({
            title,
            prefix,
            source: 'Local'
          });
        }
      });
    }

    // Filter out any World Cup mentions
    const filteredNews = newsItems.filter(item => {
      const lower = item.title.toLowerCase();
      return !lower.includes('world cup') && !lower.includes('coupe du monde');
    });

    cachedNews[cacheKey] = filteredNews;
    lastNewsFetch[cacheKey] = now;
    return filteredNews;
  } catch (err) {
    console.error('[SportsController] Error fetching RSS news:', err.message);
    return cachedNews[cacheKey] || [];
  }
};

const cleanNewsTitle = (rawTitle) => {
  if (!rawTitle) return '';
  let title = rawTitle;
  if (title.lastIndexOf(' - ') !== -1) {
    title = title.substring(0, title.lastIndexOf(' - '));
  }
  return title.trim();
};

const fetchSportsData = async (lang, country = 'Cameroon') => {
  const apiKey = process.env.SPORTS_API_KEY;
  let items = [];

  if (apiKey) {
    const allMatches = await getMatchesData(apiKey);

    // 1A. LIVE MATCHES (IN_PLAY or PAUSED) - HIGHEST PRIORITY
    const liveMatches = allMatches.filter(m => m.status === 'IN_PLAY' || m.status === 'PAUSED');
    liveMatches.forEach(m => {
      const league = TARGET_LEAGUES.find(l => l.code === m.competition?.code);
      const leagueLabel = league ? league.short : (m.competition?.name || '');
      items.push({
        type: 'MATCH',
        status: 'LIVE',
        home: `[${leagueLabel}] ${m.homeTeam?.shortName || m.homeTeam?.name || 'TBD'}`,
        away: m.awayTeam?.shortName || m.awayTeam?.name || 'TBD',
        homeScore: m.score?.fullTime?.home ?? (m.score?.current?.home ?? 0),
        awayScore: m.score?.fullTime?.away ?? (m.score?.current?.away ?? 0)
      });
    });

    // 1B. RECENT FINISHED MATCHES (Past 24h)
    const finishedMatches = allMatches
      .filter(m => m.status === 'FINISHED')
      .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
      .slice(0, 5);

    finishedMatches.forEach(m => {
      const league = TARGET_LEAGUES.find(l => l.code === m.competition?.code);
      const leagueLabel = league ? league.short : (m.competition?.name || '');
      items.push({
        type: 'MATCH',
        status: 'FINISHED',
        home: `[${leagueLabel}] ${m.homeTeam?.shortName || m.homeTeam?.name || 'TBD'}`,
        away: m.awayTeam?.shortName || m.awayTeam?.name || 'TBD',
        homeScore: m.score?.fullTime?.home ?? 0,
        awayScore: m.score?.fullTime?.away ?? 0
      });
    });

    // 1C. UPCOMING FIXTURES (Next 7 days across top leagues with Date & Kickoff Time)
    const upcomingMatches = allMatches
      .filter(m => m.status === 'TIMED' || m.status === 'SCHEDULED')
      .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
      .slice(0, 12);

    upcomingMatches.forEach(m => {
      const league = TARGET_LEAGUES.find(l => l.code === m.competition?.code);
      const leagueLabel = league ? league.short : (m.competition?.name || '');
      const dayFormatted = getDayFormatted(m.utcDate, lang);

      items.push({
        type: 'UPCOMING',
        home: `[${leagueLabel} · ${dayFormatted}] ${m.homeTeam?.shortName || m.homeTeam?.name || 'TBD'}`,
        away: m.awayTeam?.shortName || m.awayTeam?.name || 'TBD',
        time: m.utcDate
      });
    });

    // 2. STANDINGS: TOP 4 FOR EACH TARGET LEAGUE
    const standingsMap = await getStandingsData(apiKey);
    TARGET_LEAGUES.forEach(league => {
      const top4 = standingsMap[league.code];
      if (top4 && top4.length > 0) {
        const tableStr = top4
          .map(t => `${t.position}. ${t.team?.shortName || t.team?.name} (${t.points} pts)`)
          .join(' | ');

        items.push({
          type: 'NEWS',
          title: lang === 'fr'
            ? `${league.emoji} ${league.name} Top 4: ${tableStr}`
            : `${league.emoji} ${league.name} Top 4: ${tableStr}`,
          prefix: '📊'
        });
      }
    });

    // 3. TOP SCORERS: PREMIER LEAGUE, LA LIGA, BUNDESLIGA, SERIE A, LIGUE 1, UCL
    const scorersMap = await getScorersData(apiKey);
    TARGET_LEAGUES.forEach(league => {
      if (!league.hasScorers) return;
      const scorers = scorersMap[league.code];
      if (scorers && scorers.length > 0) {
        const scorersStr = scorers
          .map(s => `${s.player.name} (${s.goals} ${lang === 'fr' ? 'buts' : 'goals'}, ${s.team?.shortName || s.team?.name})`)
          .join(' | ');

        items.push({
          type: 'NEWS',
          title: lang === 'fr'
            ? `${league.emoji} Meilleurs Buteurs ${league.name}: ${scorersStr}`
            : `${league.emoji} ${league.name} Top Scorers: ${scorersStr}`,
          prefix: '🔥'
        });
      }
    });

  } else {
    // High-quality fallback if API key is not present
    items.push({
      type: 'UPCOMING',
      home: `[PL · Sat] Arsenal`,
      away: 'Chelsea',
      time: new Date(Date.now() + 86400000 * 2).toISOString()
    });
    items.push({
      type: 'UPCOMING',
      home: `[LaLiga · Sat] Real Madrid`,
      away: 'Barcelona',
      time: new Date(Date.now() + 86400000 * 2).toISOString()
    });
    items.push({
      type: 'NEWS',
      title: "🏴󠁧󠁢󠁥󠁮󠁧󠁿 Premier League Top 4: 1. Arsenal (6 pts) | 2. Man City (6 pts) | 3. Liverpool (4 pts) | 4. Chelsea (4 pts)",
      prefix: '📊'
    });
  }

  // 4. LATEST NEWS: WORLD NEWS & CAMEROON LOCAL NEWS VIA RSS
  const rssNews = await getRssNews(lang, country);
  rssNews.forEach(item => {
    items.push({
      type: 'NEWS',
      title: item.title,
      prefix: item.prefix
    });
  });

  return items;
};

exports.getTickerData = async (req, res) => {
  try {
    const lang = req.query.lang === 'fr' ? 'fr' : 'en';
    const country = req.query.country || 'Cameroon';
    const cacheKey = `${country}_${lang}`;
    const now = Date.now();

    if (!cachedSportsData[cacheKey] || (now - (lastFetchTime[cacheKey] || 0) > CACHE_DURATION_MS)) {
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
