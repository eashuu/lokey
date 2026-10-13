// Original mock "apps" used as backdrops for README demos (`--lab-page mock --lab-query kind=chat|list|desk`). They
// are laid out in viewport percentages so the dictation field and the circled item sit exactly where the demo overlays
// expect them on any display size. No third-party content, logos or text.
const font = '"Segoe UI Variable Text", "Segoe UI", Inter, system-ui, sans-serif'

function Desk({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, fontFamily: font, background: 'linear-gradient(135deg, #d9e7f7 0%, #e8def8 52%, #f9dfe7 100%)', overflow: 'hidden' }}>
      {children}
    </div>
  )
}

const win: React.CSSProperties = { position: 'absolute', left: '16%', top: '9%', width: '68%', height: '82%', borderRadius: 14, background: '#fff', boxShadow: '0 30px 80px -20px rgba(30,40,80,.35), 0 0 0 1px rgba(20,30,60,.08)', overflow: 'hidden' }
const bar: React.CSSProperties = { height: 38, display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', background: '#f3f4f8', borderBottom: '1px solid #e4e6ee', fontSize: 12, color: '#5b6070' }
const dot = (c: string): React.CSSProperties => ({ width: 11, height: 11, borderRadius: 6, background: c })

function Chat() {
  const bubble = (mine: boolean, w: number, txt: string): React.ReactNode => (
    <div style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: `${w}%`, padding: '10px 14px', borderRadius: 16, fontSize: 14, lineHeight: 1.4, background: mine ? '#2f6df6' : '#eef0f6', color: mine ? '#fff' : '#20232d' }}>{txt}</div>
  )
  return (
    <Desk>
      <div style={win}>
        <div style={bar}><i style={dot('#ff6b6b')} /><i style={dot('#ffc14d')} /><i style={dot('#4cd27a')} /><span style={{ marginLeft: 14, fontWeight: 600, color: '#20232d' }}>Messages · John M</span></div>
        <div style={{ position: 'absolute', inset: '38px 0 0 0', padding: '22px 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {bubble(false, 52, 'Are we still on for this weekend?')}
          {bubble(true, 46, 'Yes! Let me check the plan and get back to you.')}
          {bubble(false, 40, 'Great, no rush.')}
        </div>
        {/* the text field the dictation demo targets: x 30-70 %, y 72-78 % of the screen */}
        <div style={{ position: 'fixed', left: '30%', top: '74%', width: '40%', height: 48, borderRadius: 14, background: '#f6f7fb', boxShadow: 'inset 0 0 0 1px #dfe2ec', display: 'flex', alignItems: 'center', padding: '0 16px', fontSize: 14, color: '#8b90a0' }}>Message John M</div>
      </div>
    </Desk>
  )
}

function List() {
  const row = (rank: number, name: string, meta: string, c1: string, c2: string, top: string): React.ReactNode => (
    <div style={{ display: 'flex', gap: 18, alignItems: 'center', padding: '14px 8px', borderBottom: '1px solid #eceef4' }}>
      <div style={{ width: 62, height: 78, borderRadius: 8, background: `linear-gradient(160deg, ${c1}, ${c2})`, boxShadow: '0 6px 14px -6px rgba(0,0,0,.4)', flex: 'none' }} data-cover={top} />
      <div>
        <div style={{ fontSize: 17, fontWeight: 650, color: '#1c2030' }}>{rank}. {name}</div>
        <div style={{ fontSize: 12.5, color: '#7a8092', marginTop: 4 }}>{meta}</div>
        <div style={{ marginTop: 8, height: 7, width: 220, borderRadius: 4, background: '#e8ebf3' }} />
      </div>
    </div>
  )
  return (
    <Desk>
      <div style={win}>
        <div style={bar}><i style={dot('#ff6b6b')} /><i style={dot('#ffc14d')} /><i style={dot('#4cd27a')} /><span style={{ marginLeft: 14, fontWeight: 600, color: '#20232d' }}>Top 20 Adventure Games</span></div>
        <div style={{ position: 'absolute', inset: '38px 0 0 0', padding: '16px 28px' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#1c2030', marginBottom: 6 }}>Top 20 Adventure Games</div>
          {row(1, 'Ashfall', '2019 · Western · ★ 9.6', '#f4a259', '#8a2d1b', 'first')}
          {row(2, 'Neon Tide', '2021 · Cyberpunk · ★ 9.1', '#7b2cbf', '#10002b', '')}
          {row(3, 'The Long Hollow', '2017 · Mystery · ★ 8.7', '#52796f', '#1b2d28', '')}
        </div>
      </div>
    </Desk>
  )
}

export function Mock() {
  const kind = new URLSearchParams(location.hash.split('?')[1] ?? '').get('kind')
  ;(window as unknown as { __labDone: string }).__labDone = '[]'
  return kind === 'list' ? <List /> : kind === 'chat' ? <Chat /> : <Desk><span /></Desk>
}
