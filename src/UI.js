import { getActiveServerUrl } from './config.js';

export class UI {
	constructor() {
		const apiKeyInput = document.querySelector("#google-api-key")
		const latLngInput = document.querySelector("#lat-lng")
		const fetchTilesBtn = document.querySelector("#fetch")
		const downloadTilesBtn = document.querySelector("#download")
		const sseInput = document.querySelector("#sse")
		const debugSliderInput = document.querySelector("#debug-slider")
		const debugSliderContainer = document.querySelector("#debug-slider-container")

		// Load saved values
		apiKeyInput.value = localStorage.getItem("token")
		if (localStorage.getItem("coords")) {
			latLngInput.value = localStorage.getItem("coords")
		}

		if (!apiKeyInput.value) {
			document.querySelector("#instructions").style.display = "block"
		}

		debugSliderInput.oninput = (e) => {
			document.querySelector("#tile-count").innerText = String(e.target.value)
			this.onTileSliderChange(Number(e.target.value))
		}

		apiKeyInput.onchange = (e) => {
			document.querySelector("#instructions").style.display = "none"

			const token = apiKeyInput.value
			localStorage.setItem("token", token)
		}

		latLngInput.onchange = (e) => {
			const coords = e.target.value.split(',')
			this.leafletMap.panTo(coords)
		}
		fetchTilesBtn.onclick = () => {
			this.onFetch()
		}
		downloadTilesBtn.onclick = () => {
			this.onDownload()
		}
		window.onload = () => {
			const zoom = localStorage.getItem("zoom") ?
				localStorage.getItem("zoom") : 16
			const map = L.map('map', { zoomControl: false })
				.setView(latLngInput.value.split(','), zoom);

			L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
				maxZoom: 19,
				attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
			}).addTo(map)

			map.on("moveend", function () {
				const lat = map.getCenter().lat.toFixed(4)
				const lng = map.getCenter().lng.toFixed(4)
				latLngInput.value = `${lat},${lng}`
				localStorage.setItem("zoom", map.getZoom())
				localStorage.setItem("coords", latLngInput.value)
				document.querySelector("#zoom").innerText = map.getZoom()
			});


			this.leafletMap = map
			document.querySelector("#zoom").innerText = map.getZoom()
		}

		this.fetchTilesBtn = fetchTilesBtn
		this.debugSliderContainer = debugSliderContainer
		this.debugSliderInput = debugSliderInput
	}

	getGoogleAPIKey() {
		return document.querySelector("#google-api-key").value
	}

	getLatLngZoom() {
		const coords = document.querySelector("#lat-lng").value.split(',')
		const zoom = this.leafletMap.getZoom()
		return {
			lat: Number(coords[0]),
			lng: Number(coords[1]),
			zoom
		}
	}
	getTilesetUrl() {
		return getActiveServerUrl(this.getGoogleAPIKey());
	}

	getScreenSpaceError() {
		return parseInt(document.querySelector("#sse").value)
	}

	log(message) {
		const logElement = document.querySelector("#fetch-log")
		logElement.style.display = "block"
		logElement.innerText += message + "\n"

		logElement.scrollTop = logElement.scrollHeight
	}
	clearLog() {
		const logElement = document.querySelector("#fetch-log")
		logElement.style.display = "none"
		logElement.innerText = ""
	}

	setDebugSliderVisibility(bool) {
		const { debugSliderContainer } = this
		if (bool) {
			debugSliderContainer.style.display = "block"
		} else {
			debugSliderContainer.style.display = "none"
		}
	}

	updateDebugSliderRange(number) {
		const { debugSliderInput } = this
		debugSliderInput.max = number
		debugSliderInput.value = number

		document.querySelector("#tile-count").innerText = String(number)
	}
}