import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import { installWebApis } from "./lib/web-api"
import "./styles/globals.css"

installWebApis()
document.documentElement.classList.add("dark")

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
