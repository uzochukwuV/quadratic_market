import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
// Buffer polyfill for browser (some deps expect Buffer)
import { Buffer } from 'buffer'
if (typeof window !== 'undefined' && !window.Buffer) {
  window.Buffer = Buffer
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
