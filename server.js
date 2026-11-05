import express from 'express'
import { createServer as createViteServer } from 'vite'

const app = express()
app.use(express.json())

function normalizeName(value = '') {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^(dr\.?|prof\.?|professor|mr\.?|mrs\.?|ms\.?)\s+/i, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function authorMatches(searchedName, authors) {
  const searched = normalizeName(searchedName)
  if (!searched || !Array.isArray(authors) || !authors.length) return false

  const searchedParts = searched.split(/\s+/).filter(Boolean)
  const searchedLast = searchedParts.at(-1)
  const searchedInitials = searchedParts.map((part) => part[0]).filter(Boolean)

  return authors.some((author) => {
    const candidate = normalizeName(`${author.given || ''} ${author.family || author.name || ''}`)
    if (!candidate) return false
    if (candidate === searched) return true

    const candidateParts = candidate.split(/\s+/).filter(Boolean)
    const candidateLast = candidateParts.at(-1)
    const candidateFirst = candidateParts[0]
    if (!candidateLast || candidateLast !== searchedLast) return false

    const firstInitial = searchedParts[0]?.[0]
    return !firstInitial || candidateFirst?.[0] === firstInitial ||
      searchedInitials.includes(candidateFirst?.[0])
  })
}

function getPublicationDate(item) {
  const parts =
    item.published?.['date-parts']?.[0] ||
    item['published-print']?.['date-parts']?.[0] ||
    item['published-online']?.['date-parts']?.[0] ||
    item.created?.['date-time']?.slice(0, 10)?.split('-').map(Number)

  if (!Array.isArray(parts) || !parts[0]) return null
  const year = Number(parts[0])
  const month = Number(parts[1] || 1)
  const day = Number(parts[2] || 1)
  const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return { year, isoDate }
}

async function verifyLiveUrl(url) {
  if (!/^https:\/\/[^ ]+$/.test(url)) return false
  try {
    const head = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'University-Lecturer-Publication-Harvester/1.0 (mailto:ict@unn.edu.ng)' },
    })
    if (head.ok || (head.status >= 300 && head.status < 400)) return true
  } catch (error) {
    console.warn(`HEAD verification failed for ${url}:`, error.message)
  }

  try {
    const get = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
      headers: { 'Range': 'bytes=0-2047', 'User-Agent': 'University-Lecturer-Publication-Harvester/1.0 (mailto:ict@unn.edu.ng)' },
    })
    return get.ok
  } catch (error) {
    console.warn(`GET verification failed for ${url}:`, error.message)
    return false
  }
}

app.get('/api/harvest', async (req, res) => {
  const name = String(req.query.name || '').trim()
  const startYear = Number(req.query.startYear)
  const endYear = Number(req.query.endYear)

  if (!name || !Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear > endYear) {
    return res.status(400).json({ error: 'Enter a valid author name and year range.' })
  }

  try {
    const params = new URLSearchParams({
      'query.author': name,
      filter: `from-pub-date:${startYear}-01-01,until-pub-date:${endYear}-12-31`,
      rows: '100',
      sort: 'published',
      order: 'desc',
    })
    const response = await fetch(`https://api.crossref.org/works?${params}`, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'University-Lecturer-Publication-Harvester/1.0 (mailto:ict@unn.edu.ng)' },
    })
    if (!response.ok) throw new Error(`Crossref returned HTTP ${response.status}`)

    const payload = await response.json()
    const candidates = (payload.message?.items || []).filter((item) => {
      const date = getPublicationDate(item)
      return date && date.year >= startYear && date.year <= endYear &&
        authorMatches(name, item.author) &&
        typeof item.URL === 'string' && /^https:\/\/[^ ]+$/.test(item.URL) &&
        Array.isArray(item.title) && item.title[0]
    })
    console.log(`Crossref returned ${payload.message?.items?.length || 0} items; ${candidates.length} exact-author candidates`)

    const verified = []
    for (const item of candidates.slice(0, 40)) {
      if (await verifyLiveUrl(item.URL)) {
        const date = getPublicationDate(item)
        verified.push({
          id: item.DOI || item.URL,
          title: item.title[0],
          authors: item.author.map((author) => [author.given, author.family].filter(Boolean).join(' ')).join('; '),
          year: date.year,
          publicationDate: date.isoDate,
          journal: item['container-title']?.[0] || item.publisher || 'Publisher not listed',
          source: item['container-title']?.[0] || item.publisher || 'Crossref',
          link: item.URL,
          kept: true,
        })
      }
    }

    if (verified.length === 0) {
      const authorParams = new URLSearchParams({ search: name, per_page: '10' })
      const authorResponse = await fetch(`https://api.openalex.org/authors?${authorParams}`, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'University-Lecturer-Publication-Harvester/1.0 (mailto:ict@unn.edu.ng)' },
      })
      if (!authorResponse.ok) throw new Error(`OpenAlex author search returned HTTP ${authorResponse.status}`)

      const authorPayload = await authorResponse.json()
      const matchingAuthor = (authorPayload.results || []).find((author) =>
        normalizeName(author.display_name) === normalizeName(name) ||
        normalizeName(author.display_name).replace(/\s+/g, '') === normalizeName(name).replace(/\s+/g, '')
      ) || null

      if (matchingAuthor?.id) {
        const authorId = matchingAuthor.id.split('/').at(-1)
        const workParams = new URLSearchParams({
          filter: `author.id:${authorId},from_publication_date:${startYear}-01-01,to_publication_date:${endYear}-12-31`,
          per_page: '100',
          sort: 'publication_date:desc',
          select: 'id,title,authorships,publication_date,primary_location,doi',
        })
        const workResponse = await fetch(`https://api.openalex.org/works?${workParams}`, {
          signal: AbortSignal.timeout(15000),
          headers: { 'User-Agent': 'University-Lecturer-Publication-Harvester/1.0 (mailto:ict@unn.edu.ng)' },
        })
        if (!workResponse.ok) throw new Error(`OpenAlex works search returned HTTP ${workResponse.status}`)

        const workPayload = await workResponse.json()
        for (const work of workPayload.results || []) {
          const landingUrl = work.primary_location?.landing_page_url || work.doi
          if (!landingUrl || !/^https:\/\/[^ ]+$/.test(landingUrl)) continue
          if (!await verifyLiveUrl(landingUrl)) continue

          const authors = (work.authorships || [])
            .map((entry) => entry.author?.display_name)
            .filter(Boolean)
          const publicationDate = String(work.publication_date || '')
          const year = Number(publicationDate.slice(0, 4))
          if (year < startYear || year > endYear) continue

          verified.push({
            id: work.id,
            title: work.title,
            authors: authors.join('; '),
            year,
            publicationDate,
            journal: work.primary_location?.source?.display_name || 'Publisher not listed',
            source: work.primary_location?.source?.display_name || 'OpenAlex',
            link: landingUrl,
            kept: true,
          })
          if (verified.length >= 40) break
        }
      }
    }

    return res.json({ results: verified })
  } catch (error) {
    console.error('Harvest API failed:', error)
    return res.status(502).json({
      error: 'The publication search service could not be reached. Please try again shortly.',
    })
  }
})

const isProduction = process.env.NODE_ENV === 'production'

if (isProduction) {
  app.use(express.static('dist'))
  app.use((_req, res) => res.sendFile(`${process.cwd()}/dist/index.html`))
} else {
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' })
  app.use(vite.middlewares)
}

const port = Number(process.env.PORT || 5173)
app.listen(port, '127.0.0.1', () => {
  console.log(`Lecturer Publication Harvester running at http://127.0.0.1:${port}`)
})
