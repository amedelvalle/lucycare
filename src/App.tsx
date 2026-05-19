import { BrowserRouter } from 'react-router-dom'
import { AppRoutes } from './router'
import ScrollToTop from './components/ScrollToTop'


function App() {
  return (
    <BrowserRouter basename={__BASE_PATH__}>
      <ScrollToTop />
      <AppRoutes />
    </BrowserRouter>
  )
}

export default App