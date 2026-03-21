'use client';

import { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'Who are the top 5 performers?',
  'Which team has the highest impact?',
  'Who writes the most complex code?',
  'What is our AI adoption rate?',
  'Compare the Platform and Frontend teams',
  'Who improved the most recently?',
];

export default function ChatPanel({ org }: { org: string }) {
  const [open, setOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  async function send(text?: string) {
    const msg = (text || input).trim();
    if (!msg || loading) return;

    const userMsg: Message = { role: 'user', content: msg };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      const data = await res.json();
      if (data.error) {
        setMessages([...newMessages, { role: 'assistant', content: `Error: ${data.error}` }]);
      } else {
        setMessages([...newMessages, { role: 'assistant', content: data.response }]);
      }
    } catch {
      setMessages([...newMessages, { role: 'assistant', content: 'Network error — could not reach the server.' }]);
    }
    setLoading(false);
  }

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 w-12 h-12 bg-accent hover:bg-accent-dark text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 no-print"
          title="Ask Glooker"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className={`fixed z-50 bg-gray-900 border border-gray-800 shadow-2xl flex flex-col overflow-hidden no-print transition-all duration-200 ${
          maximized
            ? 'inset-4 rounded-2xl'
            : 'bottom-6 right-6 w-[420px] h-[600px] rounded-2xl'
        }`}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <div className="flex items-center gap-2">
              <span className="text-sm">🤖</span>
              <span className="text-sm font-semibold text-white">Glooker Assistant</span>
              <span className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">{org}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {messages.length > 0 && (
                <button
                  onClick={() => setMessages([])}
                  className="text-xs text-gray-600 hover:text-gray-400 px-1"
                  title="Clear chat"
                >
                  Clear
                </button>
              )}
              <button
                onClick={() => setMaximized(!maximized)}
                className="text-gray-500 hover:text-gray-300 p-1"
                title={maximized ? 'Minimize' : 'Maximize'}
              >
                {maximized ? (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                  </svg>
                )}
              </button>
              <button onClick={() => { setOpen(false); setMaximized(false); }} className="text-gray-500 hover:text-gray-300 p-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && !loading && (
              <div>
                <p className="text-xs text-gray-500 mb-3">Ask anything about your engineering team:</p>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => send(s)}
                      className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-300 px-2.5 py-1.5 rounded-lg border border-gray-700/50 transition-colors text-left"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-accent text-white'
                    : 'bg-gray-800 text-gray-300'
                }`}>
                  {msg.role === 'assistant' ? (
                    <ChatMarkdown content={msg.content} />
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-800 rounded-xl px-3 py-2 text-sm text-gray-500 flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Analyzing data...
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="px-3 py-3 border-t border-gray-800">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') send(); }}
                disabled={loading}
                placeholder="Ask about your team..."
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-accent disabled:opacity-50"
              />
              <button
                onClick={() => send()}
                disabled={!input.trim() || loading}
                className="px-3 py-2 bg-accent hover:bg-accent-dark disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ChatMarkdown({ content }: { content: string }) {
  // Split content into blocks: tables vs text
  const lines = content.split('\n');
  const blocks: Array<{ type: 'text' | 'table'; lines: string[] }> = [];
  let current: { type: 'text' | 'table'; lines: string[] } = { type: 'text', lines: [] };

  for (const line of lines) {
    const isTableLine = line.trimStart().startsWith('|');
    if (isTableLine && current.type !== 'table') {
      if (current.lines.length > 0) blocks.push(current);
      current = { type: 'table', lines: [line] };
    } else if (!isTableLine && current.type === 'table') {
      if (current.lines.length > 0) blocks.push(current);
      current = { type: 'text', lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length > 0) blocks.push(current);

  return (
    <div className="space-y-2">
      {blocks.map((block, bi) => {
        if (block.type === 'table') {
          const rows = block.lines
            .map(l => l.split('|').filter(Boolean).map(c => c.trim()))
            .filter(cells => !cells.every(c => /^[-:]+$/.test(c))); // skip separator
          if (rows.length === 0) return null;
          const header = rows[0];
          const body = rows.slice(1);
          return (
            <div key={bi} className="overflow-x-auto -mx-1">
              <table className="text-xs w-full">
                <thead>
                  <tr className="border-b border-gray-700">
                    {header.map((h, hi) => (
                      <th key={hi} className="text-left py-1 px-1.5 text-gray-300 font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((row, ri) => (
                    <tr key={ri} className="border-b border-gray-700/30">
                      {row.map((cell, ci) => (
                        <td key={ci} className="py-0.5 px-1.5 text-gray-400 whitespace-nowrap">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        // Text block
        return (
          <div key={bi}>
            {block.lines.map((line, li) => {
              if (line.trim() === '') return <br key={li} />;
              if (line.startsWith('## ')) return <p key={li} className="font-bold text-white text-sm mt-1">{line.slice(3)}</p>;
              if (line.startsWith('- ')) {
                return (
                  <div key={li} className="flex gap-1.5 items-start">
                    <span className="text-gray-600 mt-0.5">•</span>
                    <span dangerouslySetInnerHTML={{ __html: formatInline(line.slice(2)) }} />
                  </div>
                );
              }
              return <p key={li} dangerouslySetInnerHTML={{ __html: formatInline(line) }} />;
            })}
          </div>
        );
      })}
    </div>
  );
}

function formatInline(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong class="text-white">$1</strong>')
    .replace(/`(.*?)`/g, '<code class="bg-gray-700 px-1 rounded text-[11px]">$1</code>');
}
