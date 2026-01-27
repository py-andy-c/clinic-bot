import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider, createRoutesFromElements, Route } from 'react-router-dom'
import App from './App.tsx'
import './index.css'
import { errorTracking } from './utils/errorTracking'
import './i18n' // Initialize i18n

// Initialize error tracking
errorTracking.init()

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route path="*" element={<App />} />
  )
)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
