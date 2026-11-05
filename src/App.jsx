import { useEffect, useMemo, useState } from 'react'
import {
  BookOpen, ChevronDown, Download, FileText, History, LayoutDashboard,
  LogOut, Menu, MoreVertical, Pencil, Plus, Search, Trash2, Upload,
  X, CalendarDays, Users, Library, ExternalLink, Check, LoaderCircle,
} from 'lucide-react'
import { Document, Packer, Paragraph, TextRun, ExternalHyperlink, HeadingLevel, AlignmentType } from 'docx'
import { saveAs } from 'file-saver'
import { jsPDF } from 'jspdf'

const sampleArticles = []

const seedRecords = [
]

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'harvest', label: 'Harvest Articles', icon: Upload },
  { id: 'records', label: 'Saved Records', icon: History },
]

function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  return (
    <div className="min-h-screen bg-[#f1f6f2] flex items-center justify-center p-5">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-green-100 overflow-hidden">
        <div className="bg-green-800 px-8 py-8 text-white text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-white text-green-800">
            <BookOpen size={30} />
          </div>
          <h1 className="text-xl font-bold">Lecturer Publication Harvester</h1>
          <p className="mt-1 text-sm text-green-100">University ICT Unit</p>
        </div>
        <form className="space-y-5 p-8" onSubmit={(e) => { e.preventDefault(); onLogin() }}>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Email address</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="staff@unn.edu.ng" className="w-full rounded-lg border border-slate-300 px-4 py-3 outline-none focus:border-green-700 focus:ring-2 focus:ring-green-100" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Password</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" className="w-full rounded-lg border border-slate-300 px-4 py-3 outline-none focus:border-green-700 focus:ring-2 focus:ring-green-100" />
          </div>
          <button className="w-full rounded-lg bg-green-800 py-3 font-semibold text-white shadow-sm hover:bg-green-900">Sign in</button>
          <p className="text-center text-xs text-slate-400">Secure access for authorized ICT staff only</p>
        </form>
      </div>
    </div>
  )
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(() => localStorage.getItem('lph_logged_in') === 'true')
  const [page, setPage] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [records, setRecords] = useState(() => {
    const saved = localStorage.getItem('lph_records_v2')
    return saved ? JSON.parse(saved) : seedRecords
  })
  const [lecturer, setLecturer] = useState('')
  const [startYear, setStartYear] = useState('2020')
  const [endYear, setEndYear] = useState('2024')
  const [harvesting, setHarvesting] = useState(false)
  const [results, setResults] = useState([])
  const [harvestError, setHarvestError] = useState('')
  const [hasSearched, setHasSearched] = useState(false)
  const [sortBy, setSortBy] = useState('newest')
  const [yearFilter, setYearFilter] = useState('all')
  const [recordSearch, setRecordSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [toast, setToast] = useState('')

  useEffect(() => {
    localStorage.setItem('lph_records_v2', JSON.stringify(records))
    localStorage.removeItem('lph_records')
  }, [records])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2600); return () => clearTimeout(t) }, [toast])

  const login = () => { localStorage.setItem('lph_logged_in', 'true'); setLoggedIn(true) }
  const logout = () => { localStorage.removeItem('lph_logged_in'); setLoggedIn(false) }
  const totalArticles = records.reduce((sum, r) => sum + r.articles.length, 0)

  const harvest = async (e) => {
    e.preventDefault()
    if (!lecturer.trim()) return
    setHarvesting(true)
    setResults([])
    setHarvestError('')
    setHasSearched(true)
    try {
      const params = new URLSearchParams({
        name: lecturer.trim(),
        startYear,
        endYear,
      })
      const response = await fetch(`/api/harvest?${params}`, {
        headers: { Accept: 'application/json' },
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || `Search failed with HTTP ${response.status}`)
      }
      setResults(payload.results || [])
    } catch (error) {
      console.error('Article harvest failed:', error)
      setHarvestError(error.message || 'The publication search service could not be reached. Please try again shortly.')
    } finally {
      setHarvesting(false)
    }
  }

  const displayed = useMemo(() => {
    const filtered = results.filter((a) => yearFilter === 'all' || String(a.year) === yearFilter)
    return [...filtered].sort((a, b) => {
      if (sortBy === 'oldest') return a.year - b.year
      if (sortBy === 'author') return a.authors.localeCompare(b.authors)
      if (sortBy === 'title') return a.title.localeCompare(b.title)
      return b.year - a.year
    })
  }, [results, sortBy, yearFilter])

  const saveRecord = () => {
    if (!lecturer.trim() || !results.length) { setToast('Harvest articles before saving'); return }
    const kept = results.filter((a) => a.kept)
    if (!kept.length) { setToast('Select at least one article'); return }
    const record = { id: Date.now(), lecturer, range: `${startYear} - ${endYear}`, date: new Date().toISOString().slice(0, 10), articles: kept }
    setRecords((old) => [record, ...old])
    setToast('Harvest saved successfully')
  }

  const removeDuplicates = () => {
    const seen = new Set()
    setResults((old) => old.filter((a) => {
      const key = a.title.toLowerCase().trim()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }))
    setToast('Duplicates removed')
  }

  const exportWord = async (record = { lecturer: lecturer || 'Lecturer Name', range: `${startYear} - ${endYear}`, articles: results.filter((a) => a.kept) }) => {
    const articles = record.articles.length ? record.articles : results.filter((a) => a.kept)
    const children = [
      new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Publications of ${record.lecturer}`, bold: true, size: 36 })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: record.range, italics: true, color: '166534', size: 26 })] }),
      new Paragraph({ text: '' }),
      ...articles.flatMap((a, i) => [
        new Paragraph({ children: [
          new TextRun({ text: `${i + 1}. `, bold: true }),
          new TextRun({ text: `${a.authors} (${a.year}). ` }),
          new TextRun({ text: `${a.title}. `, italics: true }),
          new TextRun({ text: `${a.journal}.` }),
        ] }),
        new Paragraph({ children: [new ExternalHyperlink({ children: [new TextRun({ text: a.link, style: 'Hyperlink' })], link: a.link })] }),
        new Paragraph({ text: '' }),
      ]),
    ]
    const doc = new Document({ sections: [{ children }] })
    const blob = await Packer.toBlob(doc)
    saveAs(blob, `${record.lecturer.replaceAll(' ', '_')}_Publications.docx`)
    setToast('Word document exported')
  }

  const exportPdf = (record = { lecturer: lecturer || 'Lecturer Name', range: `${startYear} - ${endYear}`, articles: results.filter((a) => a.kept) }) => {
    const pdf = new jsPDF()
    const articles = record.articles.length ? record.articles : results.filter((a) => a.kept)
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18)
    pdf.text(`Publications of ${record.lecturer}`, 105, 25, { align: 'center' })
    pdf.setFontSize(12); pdf.setTextColor(22, 101, 52); pdf.text(record.range, 105, 34, { align: 'center' })
    pdf.setTextColor(31, 41, 55); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10)
    let y = 50
    articles.forEach((a, i) => {
      const lines = pdf.splitTextToSize(`${i + 1}. ${a.authors} (${a.year}). ${a.title}. ${a.journal}.`, 170)
      if (y + lines.length * 6 + 12 > 280) { pdf.addPage(); y = 20 }
      pdf.text(lines, 20, y); y += lines.length * 6
      pdf.setTextColor(37, 99, 235); pdf.textWithLink(a.link, 20, y, { url: a.link }); pdf.setTextColor(31, 41, 55); y += 12
    })
    pdf.save(`${record.lecturer.replaceAll(' ', '_')}_Publications.pdf`)
    setToast('PDF exported')
  }

  if (!loggedIn) return <Login onLogin={login} />

  const filteredRecords = records.filter((r) => r.lecturer.toLowerCase().includes(recordSearch.toLowerCase()))

  const navigate = (id) => { setPage(id); setSidebarOpen(false) }

  return (
    <div className="min-h-screen bg-[#f4f7f5]">
      {sidebarOpen && <button aria-label="Close menu" className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-green-900 text-white transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-20 items-center gap-3 px-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-green-800"><BookOpen size={22}/></div>
          <div><p className="text-sm font-bold leading-tight">Publication</p><p className="text-sm font-bold leading-tight">Harvester</p></div>
          <button className="ml-auto lg:hidden" onClick={() => setSidebarOpen(false)}><X size={20}/></button>
        </div>
        <nav className="mt-3 flex-1 px-3">
          {navItems.map((item) => { const Icon = item.icon; return (
            <button key={item.id} onClick={() => navigate(item.id)} className={`mb-1 flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition ${page === item.id ? 'bg-white text-green-900 shadow-sm' : 'text-green-100 hover:bg-green-800'}`}>
              <Icon size={19}/>{item.label}
            </button>
          ) })}
        </nav>
        <button onClick={logout} className="m-3 flex items-center gap-3 rounded-lg px-4 py-3 text-sm text-green-100 hover:bg-green-800"><LogOut size={19}/> Sign out</button>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center border-b border-slate-200 bg-white px-4 shadow-sm md:px-8">
          <button className="mr-3 rounded-md p-2 hover:bg-slate-100 lg:hidden" onClick={() => setSidebarOpen(true)}><Menu size={22}/></button>
          <div className="relative hidden max-w-md flex-1 md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18}/>
            <input value={recordSearch} onChange={(e) => { setRecordSearch(e.target.value); if (e.target.value) setPage('records') }} placeholder="Search saved lecturers..." className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-10 pr-4 text-sm outline-none focus:border-green-700 focus:bg-white"/>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block"><p className="text-sm font-semibold text-slate-800">ICT Administrator</p><p className="text-xs text-slate-500">University ICT Unit</p></div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-100 text-sm font-bold text-green-800">ICT</div>
          </div>
        </header>

        <main className="p-4 md:p-8">
          {page === 'dashboard' && (
            <div>
              <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="text-sm text-slate-500">Overview</p><h1 className="text-2xl font-bold text-slate-900">Dashboard</h1></div>
                <button onClick={() => navigate('harvest')} className="flex items-center justify-center gap-2 rounded-lg bg-green-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-900"><Plus size={18}/> New Harvest</button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  { label: 'Lecturers Harvested', value: records.length, icon: Users, color: 'bg-blue-50 text-blue-700' },
                  { label: 'Articles Harvested', value: totalArticles, icon: Library, color: 'bg-green-50 text-green-700' },
                  { label: 'Recent Harvests', value: records.length, icon: CalendarDays, color: 'bg-amber-50 text-amber-700' },
                ].map((stat) => { const Icon = stat.icon; return (
                  <div key={stat.label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between"><div><p className="text-sm text-slate-500">{stat.label}</p><p className="mt-2 text-3xl font-bold text-slate-900">{stat.value}</p></div><div className={`flex h-12 w-12 items-center justify-center rounded-xl ${stat.color}`}><Icon size={24}/></div></div>
                  </div>
                ) })}
              </div>
              <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><h2 className="font-bold text-slate-900">Recent Harvests</h2><button onClick={() => navigate('records')} className="text-sm font-semibold text-green-700">View all</button></div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3 font-medium">Lecturer</th><th className="px-5 py-3 font-medium">Year Range</th><th className="px-5 py-3 font-medium">Articles</th><th className="px-5 py-3 font-medium">Date</th><th className="px-5 py-3"></th></tr></thead>
                    <tbody>{records.slice(0, 5).map((r) => <tr key={r.id} className="border-t border-slate-100"><td className="px-5 py-4 font-semibold text-slate-800">{r.lecturer}</td><td className="px-5 py-4 text-slate-600">{r.range}</td><td className="px-5 py-4 text-slate-600">{r.articles.length}</td><td className="px-5 py-4 text-slate-600">{r.date}</td><td className="px-5 py-4"><button onClick={() => { setResults(r.articles.map((a) => ({ ...a, kept: true }))); setLecturer(r.lecturer); navigate('harvest') }} className="text-green-700 hover:text-green-900"><ExternalLink size={17}/></button></td></tr>)}</tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {page === 'harvest' && (
            <div>
              <div className="mb-6"><p className="text-sm text-slate-500">Publication search</p><h1 className="text-2xl font-bold text-slate-900">Harvest New Articles</h1></div>
              <form onSubmit={harvest} className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="grid gap-4 md:grid-cols-[1fr_180px_180px_auto] md:items-end">
                  <div><label className="mb-2 block text-sm font-semibold text-slate-700">Lecturer Full Name</label><input value={lecturer} onChange={(e) => setLecturer(e.target.value)} placeholder="e.g. Dr. Eze" className="w-full rounded-lg border border-slate-300 px-4 py-3 text-sm outline-none focus:border-green-700"/></div>
                  <div><label className="mb-2 block text-sm font-semibold text-slate-700">Start Year</label><input type="number" value={startYear} onChange={(e) => setStartYear(e.target.value)} className="w-full rounded-lg border border-slate-300 px-4 py-3 text-sm outline-none focus:border-green-700"/></div>
                  <div><label className="mb-2 block text-sm font-semibold text-slate-700">End Year</label><input type="number" value={endYear} onChange={(e) => setEndYear(e.target.value)} className="w-full rounded-lg border border-slate-300 px-4 py-3 text-sm outline-none focus:border-green-700"/></div>
                  <button disabled={harvesting} className="flex h-[46px] items-center justify-center gap-2 rounded-lg bg-green-800 px-5 text-sm font-semibold text-white hover:bg-green-900 disabled:opacity-70">{harvesting ? <LoaderCircle className="animate-spin" size={18}/> : <Search size={18}/>} {harvesting ? 'Harvesting...' : 'Harvest'}</button>
                </div>
              </form>

              {harvesting && <div className="rounded-xl border border-slate-200 bg-white py-16 text-center"><LoaderCircle className="mx-auto animate-spin text-green-700" size={36}/><p className="mt-4 font-semibold text-slate-700">Searching publication sources...</p><p className="mt-1 text-sm text-slate-400">Please wait while we collect the articles</p></div>}

              {!harvesting && harvestError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{harvestError}</div>}

              {!harvesting && results.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex flex-col gap-3 border-b border-slate-200 p-4 xl:flex-row xl:items-center xl:justify-between">
                    <div><h2 className="font-bold text-slate-900">{results.length} Publications Found</h2><p className="text-sm text-slate-500">{lecturer}</p></div>
                    <div className="flex flex-wrap gap-2">
                      <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none"><option value="newest">Year: Newest first</option><option value="oldest">Year: Oldest first</option><option value="author">Author: A-Z</option><option value="title">Title: A-Z</option></select>
                      <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none"><option value="all">All years</option>{[...new Set(results.map((a) => a.year))].sort((a,b)=>b-a).map((y)=><option key={y} value={y}>{y}</option>)}</select>
                      <button onClick={removeDuplicates} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Remove duplicates</button>
                    </div>
                  </div>
                  <div className="divide-y divide-slate-100">{displayed.map((a) => (
                    <div key={a.id} className="flex gap-3 p-4 md:gap-4">
                      <input type="checkbox" checked={a.kept} onChange={() => setResults((old) => old.map((x) => x.id === a.id ? { ...x, kept: !x.kept } : x))} className="mt-1 h-4 w-4 accent-green-700"/>
                      <div className="min-w-0 flex-1"><h3 className="font-semibold text-slate-900">{a.title}</h3><p className="mt-1 text-sm text-slate-600"><span className="font-medium">Authors:</span> {a.authors}</p><div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span className="rounded-full bg-green-50 px-2.5 py-1 font-semibold text-green-700">{a.publicationDate || a.year}</span><span className="text-slate-500"><span className="font-medium">Source:</span> {a.source || a.journal}</span><a href={a.link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 break-all text-blue-600 hover:underline">Open article <ExternalLink size={12}/></a></div></div>
                      <div className="flex gap-1"><button title="Edit article" onClick={() => setEditing({ ...a })} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-green-700"><Pencil size={17}/></button><button title="Delete article" onClick={() => setResults((old) => old.filter((x) => x.id !== a.id))} className="rounded-md p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 size={17}/></button></div>
                    </div>
                  ))}</div>
                  <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 p-4">
                    <button onClick={saveRecord} className="rounded-lg border border-green-700 px-4 py-2.5 text-sm font-semibold text-green-700 hover:bg-green-50">Save Record</button>
                    <button onClick={() => exportWord()} className="flex items-center gap-2 rounded-lg border border-blue-600 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50"><FileText size={17}/> Export Word</button>
                    <button onClick={() => exportPdf()} className="flex items-center gap-2 rounded-lg bg-green-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-900"><Download size={17}/> Export PDF</button>
                  </div>
                </div>
              )}
              {!harvesting && !results.length && !harvestError && <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center"><Library className="mx-auto text-slate-300" size={42}/><p className="mt-3 font-semibold text-slate-700">{hasSearched ? `No verified articles found for this author in this date range` : 'No publications loaded'}</p><p className="mt-1 text-sm text-slate-400">{hasSearched ? 'Try another name or broaden the year range.' : 'Enter a lecturer and year range to begin'}</p></div>}
            </div>
          )}

          {page === 'records' && (
            <div>
              <div className="mb-6 flex items-center justify-between"><div><p className="text-sm text-slate-500">Harvest history</p><h1 className="text-2xl font-bold text-slate-900">Saved Records</h1></div><button onClick={() => navigate('harvest')} className="hidden items-center gap-2 rounded-lg bg-green-800 px-4 py-2.5 text-sm font-semibold text-white sm:flex"><Plus size={18}/> New Harvest</button></div>
              <div className="mb-4 md:hidden"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18}/><input value={recordSearch} onChange={(e) => setRecordSearch(e.target.value)} placeholder="Search lecturers..." className="w-full rounded-lg border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm"/></div></div>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3 font-medium">Lecturer Name</th><th className="px-5 py-3 font-medium">Year Range</th><th className="px-5 py-3 font-medium">Articles</th><th className="px-5 py-3 font-medium">Date Harvested</th><th className="px-5 py-3 font-medium text-right">Actions</th></tr></thead>
                  <tbody>{filteredRecords.map((r) => <tr key={r.id} className="border-t border-slate-100"><td className="px-5 py-4 font-semibold text-slate-800">{r.lecturer}</td><td className="px-5 py-4 text-slate-600">{r.range}</td><td className="px-5 py-4 text-slate-600">{r.articles.length}</td><td className="px-5 py-4 text-slate-600">{r.date}</td><td className="px-5 py-4"><div className="flex justify-end gap-1"><button title="Open record" onClick={() => { setLecturer(r.lecturer); setResults(r.articles.map((a) => ({ ...a, kept: true }))); const [start,end]=r.range.split('-').map(v=>v.trim()); setStartYear(start||'2020'); setEndYear(end||'2024'); navigate('harvest') }} className="rounded-md p-2 text-slate-500 hover:bg-green-50 hover:text-green-700"><ExternalLink size={17}/></button><button title="Export Word" onClick={() => exportWord(r)} className="rounded-md p-2 text-slate-500 hover:bg-blue-50 hover:text-blue-700"><FileText size={17}/></button><button title="Export PDF" onClick={() => exportPdf(r)} className="rounded-md p-2 text-slate-500 hover:bg-green-50 hover:text-green-700"><Download size={17}/></button><button title="Delete record" onClick={() => setRecords((old) => old.filter((x) => x.id !== r.id))} className="rounded-md p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 size={17}/></button></div></td></tr>)}</tbody>
                </table></div>
              </div>
            </div>
          )}
        </main>
      </div>

      {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><form onSubmit={(e) => { e.preventEvent?.(); setResults((old) => old.map((a) => a.id === editing.id ? editing : a)); setEditing(null); setToast('Article updated') }} className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><h2 className="font-bold text-slate-900">Edit Article</h2><button type="button" onClick={() => setEditing(null)}><X size={20}/></button></div>
        <div className="space-y-4 p-5">
          {[['title','Article Title'],['authors','Authors'],['journal','Journal / Conference'],['year','Year'],['link','DOI / Link']].map(([key,label]) => <div key={key}><label className="mb-1 block text-sm font-semibold text-slate-700">{label}</label>{key === 'title'||key === 'journal'||key === 'link' ? <input value={editing[key]} onChange={(e) => setEditing({ ...editing, [key]: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-green-700"/> : <input type={key==='year'?'number':'text'} value={editing[key]} onChange={(e) => setEditing({ ...editing, [key]: key === 'year' ? Number(e.target.value) : e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-green-700"/>}</div>)}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4"><button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">Cancel</button><button type="button" onClick={() => { setResults((old) => old.map((a) => a.id === editing.id ? editing : a)); setEditing(null); setToast('Article updated') }} className="rounded-lg bg-green-800 px-4 py-2 text-sm font-semibold text-white">Save Changes</button></div>
      </form></div>}
      {toast && <div className="fixed bottom-5 right-5 z-[60] flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-lg"><Check size={17} className="text-green-400"/>{toast}</div>}
    </div>
  )
}
