import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Studio from "@/pages/Studio";
import OmegaRoom from "@/pages/OmegaRoom";
import GateRoom from "@/pages/GateRoom";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Studio />} />
        <Route path="/omega" element={<OmegaRoom />} />
        <Route path="/gate" element={<GateRoom />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
