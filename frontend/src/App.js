mport "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Studio from "@/pages/Studio";
import OmegaRoom from "@/pages/OmegaRoom";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Studio />} />
        <Route path="/omega" element={<OmegaRoom />} />
      </Routes>
    </BrowserRouter>
  );
