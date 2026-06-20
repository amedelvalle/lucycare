import { BrowserRouter } from 'react-router-dom'
import { AppRoutes } from './router'
import ScrollToTop from './components/ScrollToTop'
import SessionGuard from './components/SessionGuard'


function App() {
  return (
    <BrowserRouter basename={__BASE_PATH__}>
      <ScrollToTop />
      <SessionGuard />
      <AppRoutes />
    </BrowserRouter>
  )
}

export default App