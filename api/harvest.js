const USER_AGENT =
  'University-Lecturer-Publication-Harvester/1.0 (mailto:ict@unn.edu.ng)'

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

function nameMatches(searchedName, candidateName) {
  const searched = normalizeName(searchedName)
  const candidate = normalizeName(candidateName)
  if (!searched || !candidate) return false
  if (searched === candidate) return true

  const searchedParts = searched.split(/\s+/).filter(Boolean)
  const candidateParts = candidate.split(/\s+/).filter(Boolean)
  if (!searchedParts.length || !candidateParts.length) return false

  return searchedParts.at(-1) === candidateParts.at(-1) &&
    searchedParts[0][0] === candidateParts[0][0]
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
  return {
    year,
    isoDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  }
}

async function verifyLiveUrl(url) {
  if (!/^https:\/\/[^ ]+$/.test(url)) return false

  try {
    const head = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': USER_AGENT },
    })
    if (head.ok || (head.status >= 300 && head.status < 400)) return true
  } catch {
    // Some scholarly sites reject HEAD requests. Try GET below.
  }

  try {
    const get = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
      headers: { Range: 'bytes=0-2047', 'User-Agent': USER_AGENT },
    })
    return get.ok || (get.status >= 300 && get.status < 400)
  } catch {
    return false
  }
}

function normalizeArticleUrl(work) {
  const landingUrl = work.primary_location?.landing_page_url
  const doi = work.doi
  const candidates = [
    landingUrl,
    typeof doi === 'string' && /^https:\/\//.test(doi) ? doi : null,
    typeof doi === 'string' && /^10\.\d{4,9}\//.test(doi) ? `https://doi.org/${doi}` : null,
  ]
  return candidates.find((url) => typeof url === 'string' && /^https:\/\/[^ ]+$/.test(url)) || null
}

function uniqueResults(results) {
  const seen = new Set()
  return results.filter((result) => {
    const key = `${String(result.title || '').toLowerCase().trim()}|${String(result.year)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function searchSemanticScholar(name, startYear, endYear) {
  const params = new URLSearchParams({
    query: name,
    limit: '20',
    year: `${startYear}-${endYear}`,
    fields: 'title,authors,year,url,venue,publicationDate,externalIds',
  })
  const response = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search?${params}`, {
    signal: AbortSignal.timeout(12000),
    headers: {
      'User-Agent': USER_AGENT,
      ...(process.env.S2_API_KEY ? { 'x-api-key': process.env.S2_API_KEY } : {}),
    },
  })
  if (!response.ok) throw new Error(`Semantic Scholar returned HTTP ${response.status}`)
  const payload = await response.json()
  const results = []

  await Promise.all((payload.data || []).slice(0, 12).map(async (paper) => {
    const authors = (paper.authors || []).map((author) => author.name).filter(Boolean)
    if (!authors.some((authorName) => nameMatches(name, authorName))) return
    const year = Number(paper.year)
    if (!Number.isInteger(year) || year < startYear || year > endYear) return

    let link = typeof paper.url === 'string' ? paper.url : ''
    if (!/^https:\/\//.test(link) && paper.externalIds?.DOI) {
      link = `https://doi.org/${paper.externalIds.DOI}`
    }
    if (!/^https:\/\//.test(link) || !await verifyLiveUrl(link)) return

    results.push({
      id: paper.paperId || link,
      title: paper.title,
      authors: authors.join('; '),
      year,
      publicationDate: paper.publicationDate || `${year}-01-01`,
      journal: paper.venue || 'Publisher not listed',
      source: paper.venue || 'Semantic Scholar',
      link,
      kept: true,
    })
  }))
  return results
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const query = req.query || {}
  const name = String(query.name || '').trim()
  const organization = String(query.organization || '').trim()
  const mode = String(query.mode || (name ? 'person' : 'organization')).trim()
  const startYear = Number(query.startYear)
  const endYear = Number(query.endYear)

  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear > endYear) {
    return res.status(400).json({ error: 'Enter a valid year range.' })
  }
  if (mode === 'person' && !name) {
    return res.status(400).json({ error: 'Enter the lecturer name.' })
  }
  if (mode === 'organization' && !organization) {
    return res.status(400).json({ error: 'Enter an organization name.' })
  }

  try {
    if (mode === 'organization') {
      const institutionSearch = normalizeName(organization).startsWith('university of nigeria')
        ? 'University of Nigeria'
        : organization
      const institutionParams = new URLSearchParams({
        search: institutionSearch,
        per_page: '10',
      })
      const institutionResponse = await fetch(
        `https://api.openalex.org/institutions?${institutionParams}`,
        { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': USER_AGENT } }
      )
      if (!institutionResponse.ok) {
        throw new Error(`OpenAlex institution search returned HTTP ${institutionResponse.status}`)
      }

      const institutionPayload = await institutionResponse.json()
      const normalizedOrganization = normalizeName(organization)
      const institution = (institutionPayload.results || []).find((item) =>
        normalizeName(item.display_name) === normalizedOrganization
      ) || (institutionPayload.results || []).find((item) => {
        const candidate = normalizeName(item.display_name)
        return candidate.includes(normalizedOrganization) ||
          normalizedOrganization.includes(candidate)
      })

      const verified = []
      if (institution?.id) {
        const workParams = new URLSearchParams({
          filter: `institutions.id:${institution.id.split('/').at(-1)},from_publication_date:${startYear}-01-01,to_publication_date:${endYear}-12-31`,
          per_page: '25',
          sort: 'publication_date:desc',
          select: 'id,title,authorships,publication_date,primary_location,doi',
        })
        const workResponse = await fetch(
          `https://api.openalex.org/works?${workParams}`,
          { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': USER_AGENT } }
        )
        if (!workResponse.ok) {
          throw new Error(`OpenAlex works search returned HTTP ${workResponse.status}`)
        }

        const workPayload = await workResponse.json()
        await Promise.all((workPayload.results || []).slice(0, 15).map(async (work) => {
          const link = normalizeArticleUrl(work)
          if (!link || !await verifyLiveUrl(link)) return

          const publicationDate = String(work.publication_date || '')
          const year = Number(publicationDate.slice(0, 4))
          if (year < startYear || year > endYear) return

          const authors = (work.authorships || [])
            .map((entry) => entry.author?.display_name)
            .filter(Boolean)
          verified.push({
            id: work.id,
            title: work.title,
            authors: authors.join('; '),
            year,
            publicationDate,
            journal: work.primary_location?.source?.display_name || 'Publisher not listed',
            source: work.primary_location?.source?.display_name || 'OpenAlex',
            link,
            kept: true,
          })
        }))
      }

      if (verified.length === 0) {
        const crossrefParams = new URLSearchParams({
          'query.affiliation': organization,
          filter: `from-pub-date:${startYear}-01-01,until-pub-date:${endYear}-12-31`,
          rows: '50',
          sort: 'published',
          order: 'desc',
        })
        try {
          const crossrefResponse = await fetch(`https://api.crossref.org/works?${crossrefParams}`, {
            signal: AbortSignal.timeout(12000),
            headers: { 'User-Agent': USER_AGENT },
          })
          if (crossrefResponse.ok) {
            const payload = await crossrefResponse.json()
            await Promise.all((payload.message?.items || []).slice(0, 25).map(async (item) => {
              const date = getPublicationDate(item)
              const affiliationText = (item.author || []).flatMap((author) =>
                (author.affiliation || []).map((entry) => entry.name || '')
              ).join(' ')
              const affiliated = normalizeName(affiliationText).includes(normalizeName(organization))
              if (!date || date.year < startYear || date.year > endYear || !affiliated ||
                  !/^https:\/\/[^ ]+$/.test(item.URL || '')) return
              if (!await verifyLiveUrl(item.URL)) return
              verified.push({
                id: item.DOI || item.URL,
                title: item.title?.[0] || 'Untitled publication',
                authors: (item.author || []).map((author) =>
                  [author.given, author.family].filter(Boolean).join(' ')
                ).join('; '),
                year: date.year,
                publicationDate: date.isoDate,
                journal: item['container-title']?.[0] || item.publisher || 'Publisher not listed',
                source: item['container-title']?.[0] || item.publisher || 'Crossref',
                link: item.URL,
                kept: true,
              })
            }))
          }
        } catch (error) {
          console.error('Crossref organization affiliation search failed:', error)
        }
      }

      const organizationVerified = uniqueResults(verified)
      organizationVerified.sort((a, b) => b.publicationDate.localeCompare(a.publicationDate))
      return res.status(200).json({ results: organizationVerified, searchMode: 'organization' })
    }

    const crossrefParams = new URLSearchParams({
      'query.author': name,
      filter: `from-pub-date:${startYear}-01-01,until-pub-date:${endYear}-12-31`,
      rows: '100',
      sort: 'published',
      order: 'desc',
    })
    const crossrefResponse = await fetch(
      `https://api.crossref.org/works?${crossrefParams}`,
      { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': USER_AGENT } }
    )
    if (!crossrefResponse.ok) {
      throw new Error(`Crossref returned HTTP ${crossrefResponse.status}`)
    }

    const crossrefPayload = await crossrefResponse.json()
    const candidates = (crossrefPayload.message?.items || []).filter((item) => {
      const date = getPublicationDate(item)
      return date && date.year >= startYear && date.year <= endYear &&
        item.author && item.author.some((author) =>
          nameMatches(name, `${author.given || ''} ${author.family || author.name || ''}`)
        ) &&
        typeof item.URL === 'string' && /^https:\/\/[^ ]+$/.test(item.URL) &&
        Array.isArray(item.title) && item.title[0]
    })

    const verified = []
    await Promise.all(candidates.slice(0, 15).map(async (item) => {
      if (!await verifyLiveUrl(item.URL)) return
      const date = getPublicationDate(item)
      verified.push({
        id: item.DOI || item.URL,
        title: item.title[0],
        authors: item.author.map((author) =>
          [author.given, author.family].filter(Boolean).join(' ')
        ).join('; '),
        year: date.year,
        publicationDate: date.isoDate,
        journal: item['container-title']?.[0] || item.publisher || 'Publisher not listed',
        source: item['container-title']?.[0] || item.publisher || 'Crossref',
        link: item.URL,
        kept: true,
      })
    }))

    if (process.env.SERPAPI_KEY) {
      try {
        const scholarParams = new URLSearchParams({
          engine: 'google_scholar',
          q: `author:"${name}"`,
          as_ylo: String(startYear),
          as_yhi: String(endYear),
          num: '20',
          api_key: process.env.SERPAPI_KEY,
        })
        const scholarResponse = await fetch(`https://serpapi.com/search.json?${scholarParams}`, {
          signal: AbortSignal.timeout(12000),
        })
        if (scholarResponse.ok) {
          const scholarPayload = await scholarResponse.json()
          await Promise.all((scholarPayload.organic_results || []).slice(0, 12).map(async (paper) => {
            const summary = paper.publication_info?.summary || ''
            if (!summary.toLowerCase().includes(normalizeName(name).split(/\s+/).at(-1))) return
            const yearMatch = summary.match(/\b(19|20)\d{2}\b/)
            const year = yearMatch ? Number(yearMatch[0]) : null
            if (!year || year < startYear || year > endYear) return
            const link = String(paper.link || '')
            if (!/^https:\/\//.test(link) || !await verifyLiveUrl(link)) return
            verified.push({
              id: link,
              title: paper.title,
              authors: summary.replace(/\s+-\s+.*/, '').trim(),
              year,
              publicationDate: `${year}-01-01`,
              journal: paper.publication_info?.summary?.split(' - ').at(-1) || 'Google Scholar',
              source: 'Google Scholar',
              link,
              kept: true,
            })
          }))
        }
      } catch (error) {
        console.error('Google Scholar SerpAPI search failed:', error)
      }
    }

    try {
      verified.push(...await searchSemanticScholar(name, startYear, endYear))
    } catch (error) {
      console.error('Semantic Scholar search failed:', error)
    }

    const authorParams = new URLSearchParams({ search: name, per_page: '10' })
    const authorResponse = await fetch(
      `https://api.openalex.org/authors?${authorParams}`,
      { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': USER_AGENT } }
    )
    if (!authorResponse.ok) {
      throw new Error(`OpenAlex author search returned HTTP ${authorResponse.status}`)
    }

    const authorPayload = await authorResponse.json()
    const matchingAuthor = (authorPayload.results || []).find((author) =>
      nameMatches(name, author.display_name)
    )
    if (!matchingAuthor?.id) {
      const combinedNoAuthor = uniqueResults(verified)
      combinedNoAuthor.sort((a, b) => b.publicationDate.localeCompare(a.publicationDate))
      return res.status(200).json({ results: combinedNoAuthor, searchMode: 'person' })
    }

    const workParams = new URLSearchParams({
      filter: `author.id:${matchingAuthor.id.split('/').at(-1)},from_publication_date:${startYear}-01-01,to_publication_date:${endYear}-12-31`,
      per_page: '25',
      sort: 'publication_date:desc',
      select: 'id,title,authorships,publication_date,primary_location,doi',
    })
    const workResponse = await fetch(
      `https://api.openalex.org/works?${workParams}`,
      { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': USER_AGENT } }
    )
    if (!workResponse.ok) {
      throw new Error(`OpenAlex works search returned HTTP ${workResponse.status}`)
    }

    const workPayload = await workResponse.json()
    const fallbackVerified = []
    await Promise.all((workPayload.results || []).slice(0, 15).map(async (work) => {
      const link = normalizeArticleUrl(work)
      if (!link || !await verifyLiveUrl(link)) return

      const authors = (work.authorships || [])
        .map((entry) => entry.author?.display_name)
        .filter(Boolean)
      if (!authors.some((authorName) => nameMatches(name, authorName))) return

      const publicationDate = String(work.publication_date || '')
      const year = Number(publicationDate.slice(0, 4))
      if (year < startYear || year > endYear) return

      fallbackVerified.push({
        id: work.id,
        title: work.title,
        authors: authors.join('; '),
        year,
        publicationDate,
        journal: work.primary_location?.source?.display_name || 'Publisher not listed',
        source: work.primary_location?.source?.display_name || 'OpenAlex',
        link,
        kept: true,
      })
    }))

    const combinedVerified = uniqueResults([...verified, ...fallbackVerified])
    combinedVerified.sort((a, b) => b.publicationDate.localeCompare(a.publicationDate))
    return res.status(200).json({ results: combinedVerified, searchMode: 'person' })
  } catch (error) {
    console.error('Vercel harvest API failed:', error)
    return res.status(502).json({
      error: 'The publication search service could not be reached. Please try again shortly.',
    })
  }
}
