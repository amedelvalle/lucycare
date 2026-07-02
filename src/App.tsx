import { BrowserRouter } from 'react-router-dom'
import { AppRoutes } from './router'
import ScrollToTop from './components/ScrollToTop'
import SessionGuard from './components/SessionGuard'
import PublicAnalytics from './components/PublicAnalytics'


function App() {
  return (
    <BrowserRouter basename={__BASE_PATH__}>
      <ScrollToTop />
      <SessionGuard />
      <PublicAnalytics />
      <AppRoutes />
    </BrowserRouter>
  )
}

export default App