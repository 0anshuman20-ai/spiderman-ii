import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Studio from "@/pages/Studio";
import OmegaRoom from "@/pages/OmegaRoom";
import GateRoom from "@/pages/GateRoom";
import RetestRoom from "@/pages/RetestRoom";
import LensLab from "@/pages/LensLab";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Studio />} />
        <Route path="/omega" element={<OmegaRoom />} />
        <Route path="/gate" element={<GateRoom />} />
        <Route path="/retest" element={<RetestRoom />} />
        {/* dev-only lens geometry harness — see pages/LensLab.jsx */}
        <Route path="/lenslab" element={<LensLab />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
