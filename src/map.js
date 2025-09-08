/* ====================================================================
 * map.js – Google Photorealistic 3D-tiles ⇄ on-demand voxel / MC view
 * ===================================================================*/

import * as THREE                   from 'three';
import { OrbitControls }            from 'three/examples/jsm/controls/OrbitControls.js';
import { WebGPURenderer }           from 'three/webgpu';

import { TilesRenderer }            from '3d-tiles-renderer';
import { TileCompressionPlugin,
         TilesFadePlugin,
         GLTFExtensionsPlugin       } from '3d-tiles-renderer/plugins';
import { DRACOLoader                } from 'three/examples/jsm/loaders/DRACOLoader.js';

import { voxelizeModel              } from './voxelize-model.js';
import { initBlockData,
         assignVoxelsToBlocks,
         applyAtlasToExistingVoxelMesh,
         restoreVoxelOriginalMaterial } from './assignToBlocksForGLB.js';
import { SingleSceneViewer          } from './SingleSceneViewer.js';
import { SingleSceneFetcher         } from './SingleSceneFetcher.js';

/* ─────────────────────────── ChatGPT-style HUD ───────────────────────── */
class HUD {
  constructor() {
    // Debug: check what elements we can find
    console.log('DOM ready state:', document.readyState);
    console.log('Body children:', document.body?.children?.length);
    
    // Settings menu popup
    const menu         = document.querySelector('#settings-menu');
    const composerPlus = document.querySelector('#composer-plus');
    const closeMenu    = document.querySelector('#menu-close');
    
    // Voxelization methods menu
    const voxelMethodsMenu = document.querySelector('#voxel-methods-menu');
    const voxelMethodsBtn  = document.querySelector('#voxel-methods-btn');
    const voxelMethodsBack = document.querySelector('#voxel-methods-back');
    const voxelMethodsClose = document.querySelector('#voxel-methods-close');

    console.log('Elements found:', { 
      menu: !!menu, composerPlus: !!composerPlus, closeMenu: !!closeMenu,
      voxelMethodsMenu: !!voxelMethodsMenu, voxelMethodsBtn: !!voxelMethodsBtn, voxelMethodsBack: !!voxelMethodsBack, voxelMethodsClose: !!voxelMethodsClose
    });

  // Single Scene mini-map handles (populated in _initializeSingleSceneMap)
  this._singleMap = null;
  this._singleMapMarker = null;

    if (!menu || !composerPlus || !closeMenu) {
      console.error('Missing menu elements:', { menu, composerPlus, closeMenu });
      // Let's try to continue without menu functionality
      this._initializeBasicElements();
      return;
    }

    const openMenu          = () => { 
      console.log('Opening menu');
      menu.classList.remove('hidden'); 
      voxelMethodsMenu?.classList.add('hidden');
    };
    const hideMenu          = () => { 
      console.log('Closing menu');
      menu.classList.add('hidden'); 
      voxelMethodsMenu?.classList.add('hidden');
    };
    const openVoxelMethods  = () => {
      console.log('Opening voxel methods menu');
      menu?.classList.add('hidden');
      voxelMethodsMenu?.classList.remove('hidden');
    };
    const closeVoxelMethods = () => {
      console.log('Closing voxel methods menu');
      voxelMethodsMenu?.classList.add('hidden');
    };
    const backToSettings = () => {
      console.log('Going back to settings menu');
      voxelMethodsMenu?.classList.add('hidden');
      menu?.classList.remove('hidden');
    };
    
    // Add event listeners with proper event handling
    composerPlus.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('Plus button clicked');
      if (menu.classList.contains('hidden')) {
        openMenu();
      } else {
        hideMenu();
      }
    });
    
    closeMenu.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideMenu();
    });

    // Voxelization methods navigation
    if (voxelMethodsBtn) {
      voxelMethodsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openVoxelMethods();
      });
    }

    if (voxelMethodsBack) {
      voxelMethodsBack.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        backToSettings();
      });
    }

    if (voxelMethodsClose) {
      voxelMethodsClose.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeVoxelMethods();
      });
    }

    // Close menus when clicking outside
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && 
          !voxelMethodsMenu?.contains(e.target) &&
          e.target !== composerPlus && 
          !composerPlus.contains(e.target)) {
        hideMenu();
      }
    });

    // Prevent menus from closing when interacting with form elements inside
    menu.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    if (voxelMethodsMenu) {
      voxelMethodsMenu.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }

    this._initializeBasicElements();
    this._initializeModelPicker();
  }

  _initializeModelPicker() {
    const modelPickerBtn = document.querySelector('#model-picker-btn');
    const modelPickerMenu = document.querySelector('#model-picker-menu');
    const modelPickerArrow = document.querySelector('#model-picker-arrow');
    const modelOptions = document.querySelectorAll('.model-option');
    const singleScenePanel = document.querySelector('#single-scene-panel');

    if (!modelPickerBtn || !modelPickerMenu) return;

    // Toggle dropdown
    modelPickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = modelPickerMenu.classList.contains('hidden');
      
      if (isHidden) {
        modelPickerMenu.classList.remove('hidden');
        modelPickerArrow.style.transform = 'rotate(180deg)';
      } else {
        modelPickerMenu.classList.add('hidden');
        modelPickerArrow.style.transform = 'rotate(0deg)';
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!modelPickerMenu.contains(e.target) && e.target !== modelPickerBtn) {
        modelPickerMenu.classList.add('hidden');
        modelPickerArrow.style.transform = 'rotate(0deg)';
      }
    });

    // Handle model selection
    modelOptions.forEach(option => {
      option.addEventListener('click', (e) => {
        e.preventDefault();
        const selectedModel = option.dataset.model;
        
        // Update UI selection state
        modelOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        
        // Close dropdown
        modelPickerMenu.classList.add('hidden');
        modelPickerArrow.style.transform = 'rotate(0deg)';
        
        // Handle model switch
        this.switchToModel(selectedModel);
      });
    });

    this._initializeSingleScene();
  }

  switchToModel(modelType) {
    const singleScenePanel = document.querySelector('#single-scene-panel');
    const modelPickerBtn = document.querySelector('#model-picker-btn');
    
    if (modelType === 'single-scene') {
      // Hide the main 3D tiles and show single scene interface
      this.setStatus('Single Scene Mode - Ready');
      singleScenePanel.classList.remove('hidden');
  this._scheduleMiniMapInvalidate?.();
      
      // Update model picker button text
      if (modelPickerBtn) {
        const titleEl = modelPickerBtn.querySelector('.text-sm.font-medium');
        const subtitleEl = modelPickerBtn.querySelector('.text-xs.opacity-60');
        if (titleEl) titleEl.textContent = 'Single Scene';
        if (subtitleEl) subtitleEl.textContent = 'export specific area';
      }
      
      // Clean up existing tiles if any
      if (window.tiles) {
        scene.remove(window.tiles.group);
        window.tiles.dispose();
        window.tiles = null;
      }
      
      // Initialize single scene viewer with empty scene immediately
      this.initializeSingleSceneViewer();
      
    } else {
      // Switch back to voxel earth mode
      singleScenePanel.classList.add('hidden');
      this.setStatus('Voxel Earth Mode');
      
      // Update model picker button text
      if (modelPickerBtn) {
        const titleEl = modelPickerBtn.querySelector('.text-sm.font-medium');
        const subtitleEl = modelPickerBtn.querySelector('.text-xs.opacity-60');
        if (titleEl) titleEl.textContent = 'Voxel Earth 1.0';
        if (subtitleEl) subtitleEl.textContent = 'with Google Earth tiles';
      }
      
      // Clean up single scene viewer if exists
      if (window.singleSceneViewer) {
        window.singleSceneViewer.destroy();
        window.singleSceneViewer = null;
      }
      
      // Reinitialize main tiles if we have an API key
      const key = this.getKey();
      if (key) {
        const [lat, lon] = this.getLatLon();
        const root = `https://tile.googleapis.com/v1/3dtiles/root.json?key=${key}`;
  this.setStatus('Loading tiles...');
  ensureTiles(root, key);
  retargetTiles(lat, lon);
      }
    }
  }

  initializeSingleSceneViewer() {
    // Create a basic SingleSceneViewer instance for the empty scene
    if (!window.singleSceneViewer) {
      window.singleSceneViewer = new SingleSceneViewer();
  // Reflect initial debug tiles state if toggle exists
  document.querySelector('#single-scene-debug-tiles')?.dispatchEvent(new Event('change'));
    }
  }

  _initializeSingleScene() {
    this._initializeSingleSceneControls();
    this._initializeSingleSceneMap();
  }

  _initializeSingleSceneControls() {
  const fetchBtn = document.querySelector('#single-scene-fetch');
  const downloadBtn = document.querySelector('#single-scene-download');
  const toggleVoxels = document.querySelector('#single-scene-toggle-voxels');
  const debugTilesToggle = document.querySelector('#single-scene-debug-tiles');
  const radiusSlider = document.querySelector('#single-scene-radius');
  const rotSlider = document.querySelector('#single-scene-rot');
  const tileSlider = document.querySelector('#single-scene-tile-slider');
  const resPills = document.querySelectorAll('.single-scene-res-pill');
  const resFine = document.querySelector('#single-scene-res-fine');
  const sseSlider = document.querySelector('#single-scene-sse');
  const sseValue  = document.querySelector('#single-scene-sse-value');
  const radiusValue = document.querySelector('#single-scene-radius-value');
  const rotValue = document.querySelector('#single-scene-rot-value');

    // Unhide rows if present (SSE + Debug)
    document.querySelector('#single-scene-sse-row')?.classList.remove('hidden');
    document.querySelector('#single-scene-debug-row')?.classList.remove('hidden');
    // SSE slider update
    if (sseSlider && sseValue) {
      sseSlider.addEventListener('input', () => {
        sseValue.textContent = sseSlider.value;
      });
      sseValue.textContent = sseSlider.value;
    }

    // Slider filled track updater
    const _setSliderFill = (el) => {
      if (!el) return;
      const min = +el.min || 0, max = +el.max || 100, val = +el.value || 0;
      const p = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
      el.style.setProperty('--p', p + '%');
    };
    [sseSlider, radiusSlider, resFine, rotSlider, tileSlider].forEach(el => {
      if (!el) return;
      _setSliderFill(el);
      el.addEventListener('input', () => _setSliderFill(el));
    });

    // Radius slider (meters) default 500
    if (radiusSlider && radiusValue) {
      const updateRadius = () => { radiusValue.textContent = `${parseInt(radiusSlider.value||500,10)} m`; };
      radiusSlider.addEventListener('input', updateRadius);
      updateRadius();
    }

    // Rotation (Y) slider
    if (rotSlider && rotValue) {
      const updateRot = () => { rotValue.textContent = `${parseInt(rotSlider.value||0,10)}°`; };
      rotSlider.addEventListener('input', async () => {
        updateRot();
        if (document.querySelector('#single-scene-toggle-voxels')?.checked) {
          await this._rebuildSingleSceneVoxels(parseInt(resFine?.value||64,10));
        }
      });
      updateRot();
    }

    // Resolution pills
    const highlightResPill = (val) => {
      resPills.forEach(pill => pill.classList.remove('active'));
      const active = document.querySelector(`.single-scene-res-pill[data-res="${val}"]`);
      if (active) active.classList.add('active');
    };

    resPills.forEach(pill => {
      pill.addEventListener('click', async () => {
        const res = parseInt(pill.dataset.res);
        if (resFine) resFine.value = res;
        highlightResPill(res);
        // auto rebuild if single-scene voxels are on
        if (document.querySelector('#single-scene-toggle-voxels')?.checked) {
          await this._rebuildSingleSceneVoxels(res);
        }
      });
    });

    if (resFine) {
      const debounced = ((fn, ms)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; })(async val=>{
        const res = parseInt(val, 10) || 64;
        const closest = [32,64,128,256].reduce((p,c)=>Math.abs(c-res)<Math.abs(p-res)?c:p);
        highlightResPill(closest);
        if (document.querySelector('#single-scene-toggle-voxels')?.checked) {
          await this._rebuildSingleSceneVoxels(res);
        }
      }, 200);

      resFine.addEventListener('input', e => debounced(e.target.value));
    }

    // Initialize with medium resolution
    highlightResPill(64);

  // Default voxels ON for Single Scene
  if (toggleVoxels) toggleVoxels.checked = true;

    // Fetch tiles button
    if (fetchBtn) {
      fetchBtn.addEventListener('click', async () => {
        const apiKey = this.getKey();
        const coordsInput = document.querySelector('#single-scene-coords');
        // Use the new SSE slider for single scene
        const sseInput = document.querySelector('#single-scene-sse');

        // Get coordinates from single scene panel or fall back to main coords
        let lat, lon;
        if (coordsInput && coordsInput.value.trim()) {
          const coords = coordsInput.value.trim().split(',');
          lat = parseFloat(coords[0]);
          lon = parseFloat(coords[1]);
        } else {
          [lat, lon] = this.getLatLon();
        }

        // Get SSE from the slider (default 20)
        const sse = sseInput ? parseInt(sseInput.value) || 20 : 20;

  // Radius in meters (controls how large an area to fetch)
  const radiusM = radiusSlider ? (parseInt(radiusSlider.value,10) || 500) : 500;

        if (!apiKey) {
          this._showSingleSceneLog();
          this._logSingleScene('❌ No Google API key found in settings.');
          this._logSingleScene('Please set your API key:');
          this._logSingleScene('1. Click the + button in the bottom bar');
          this._logSingleScene('2. Enter your Google API key');
          this._logSingleScene('3. Click Save');
          this._logSingleScene('4. Try fetching tiles again');
          return;
        }

        if (isNaN(lat) || isNaN(lon)) {
          this._showSingleSceneLog();
          this._logSingleScene('❌ Invalid coordinates. Please select a location on the map.');
          return;
        }

        try {
          fetchBtn.disabled = true;
          fetchBtn.textContent = 'Fetching...';
          this._showSingleSceneLog();
          this._logSingleScene('Fetching tiles...');

          const fetcher = new SingleSceneFetcher();
          // zoom auto-computed from radius; pass null for zoom and provide radiusM
          const urls = await fetcher.fetch3DTiles(lat, lon, null, sse, apiKey, this._logSingleScene.bind(this), radiusM);

          if (urls.length === 0) {
            this._logSingleScene('No tiles found for this location');
            return;
          }

          // Load the tiles into the existing viewer
          if (window.singleSceneViewer) {
            await window.singleSceneViewer.loadGLTFTiles(urls, this._logSingleScene.bind(this));
          }

          // Show tile controls and enable voxels toggle
          document.querySelector('#single-scene-tile-controls')?.classList.remove('hidden');
          document.querySelector('#single-scene-tile-count').textContent = urls.length;

          if (toggleVoxels) {
            toggleVoxels.disabled = false;
            if (toggleVoxels.checked) {
              const res = parseInt(resFine?.value || 64, 10);
              await this._rebuildSingleSceneVoxels(res);
            }
          }
          // Apply debug state to viewer if present
          if (debugTilesToggle && window.singleSceneViewer?.setDebugTiles) {
            window.singleSceneViewer.setDebugTiles(!!debugTilesToggle.checked);
          }

          this._logSingleScene(`Successfully loaded ${urls.length} tiles`);

        } catch (error) {
          this._logSingleScene(`Error: ${error.message}`);
        } finally {
          fetchBtn.disabled = false;
          fetchBtn.textContent = 'Fetch Tiles';
        }
      });
    }

    // Debug Tiles toggle (per-tile bounding boxes)
    if (debugTilesToggle) {
      debugTilesToggle.addEventListener('change', () => {
        window.singleSceneViewer?.setDebugTiles?.(!!debugTilesToggle.checked);
      });
    }

    // Tile visibility slider
    if (tileSlider) {
      tileSlider.addEventListener('input', () => {
        const value = parseInt(tileSlider.value);
        if (window.singleSceneViewer && window.singleSceneViewer.gltfArray) {
          window.singleSceneViewer.gltfArray.forEach((gltf, index) => {
            if (gltf && gltf.scene) {
              gltf.scene.visible = index <= value;
            }
          });
        }
      });
    }

    // Voxelize button
    // Remove the separate voxelize button and use the toggle as the only control
    if (toggleVoxels) {
      toggleVoxels.addEventListener('change', async () => {
        const viewer = window.singleSceneViewer;
        const container = viewer?.tilesContainer;
        if (!viewer || !container) {
          this._logSingleScene('❌ Error: No tiles loaded to voxelize');
          toggleVoxels.checked = false;
          return;
        }

        const wantOn = toggleVoxels.checked;
        const res = parseInt(resFine?.value || 64, 10);

        if (wantOn) {
          const vox = container.getObjectByName('singleSceneVoxels');
          const currRes = vox?.userData?.resolution;
          if (!vox || currRes !== res) {
            await this._rebuildSingleSceneVoxels(res);
          } else {
            this._setSingleSceneVisibility(true);
            this._logSingleScene('✅ Voxels shown.');
          }
        } else {
          this._setSingleSceneVisibility(false);
          this._logSingleScene('✅ Original tiles shown.');
        }
      });
    }

    // Download button (Single Scene panel)
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        if (window.singleSceneViewer) {
          window.singleSceneViewer.generateCombineGltf();
          this._logSingleScene('Export started...');
        }
      });
    }

    // Global Export GLB button (exports whatever is currently visible)
    const exportGlbBtn = document.getElementById('export-glb-btn');
    if (exportGlbBtn) {
      exportGlbBtn.addEventListener('click', () => {
        // Prefer Single Scene if active, else main viewer
        if (window.singleSceneViewer && window.singleSceneViewer.scene) {
          window.singleSceneViewer.generateCombineGltf();
          this._logSingleScene?.('Export started (Single Scene)...');
        } else if (window.viewer && window.viewer.scene) {
          // If you have a main viewer, call its export method here
          window.viewer.generateCombineGltf?.();
          // Optionally log to main status
          this.setStatus?.('Export started (Main Viewer)...');
        } else {
          alert('No active scene to export.');
        }
      });
    }

  // No duplicate toggle handler — visibility logic handled by the single toggle above
  }

  _initializeSingleSceneMap() {
    const mapContainer = document.querySelector('#single-scene-map');
    if (!mapContainer || typeof L === 'undefined') return;
    try {
      const [lat, lon] = this.getLatLon();
      const map = L.map('single-scene-map').setView([lat || 40.6891, lon || -74.0446], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);

      let marker = L.marker([lat || 40.6891, lon || -74.0446]).addTo(map);
  map.whenReady(() => this._scheduleMiniMapInvalidate());

      map.on('click', (e) => {
        const { lat, lng } = e.latlng;
        marker.setLatLng([lat, lng]);
        // Persist into the shared coords so the Fetch button uses these.
        this.setLatLon([lat, lng]);
      });

      // When the mini-map view changes (pan/zoom), update marker + coords
      map.on('moveend', () => {
        const c = map.getCenter();
        marker.setLatLng([c.lat, c.lng]);
        this.setLatLon([c.lat, c.lng]);
        const coordsInput = document.querySelector('#single-scene-coords');
        if (coordsInput) coordsInput.value = `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`;
      });

  // Save handles for later sync
  this._singleMap = map;
  this._singleMapMarker = marker;
      // Observers for size/visibility changes
      this._installMiniMapObservers(map, document.querySelector('#single-scene-panel'), mapContainer);
    } catch (error) {
      console.error('Failed to initialize single scene map:', error);
    }
  }

  // Debounced (RAF) Leaflet invalidate
  _scheduleMiniMapInvalidate() {
    if (!this._singleMap) return;
    cancelAnimationFrame(this._miniMapInvalidateRAF);
    this._miniMapInvalidateRAF = requestAnimationFrame(() => {
      try { this._singleMap.invalidateSize(true); } catch {}
    });
  }

  // Install observers to react to panel visibility and size changes
  _installMiniMapObservers(map, panelEl, containerEl) {
    // ResizeObserver
    try {
      this._miniMapResizeObs?.disconnect?.();
      this._miniMapResizeObs = new ResizeObserver(() => this._scheduleMiniMapInvalidate());
      if (panelEl) this._miniMapResizeObs.observe(panelEl);
      if (containerEl) this._miniMapResizeObs.observe(containerEl);
    } catch {}

    // MutationObserver for class changes (.hidden toggle)
    if (panelEl) {
      this._miniMapMutationObs?.disconnect?.();
      this._miniMapMutationObs = new MutationObserver(muts => {
        for (const m of muts) {
          if (m.type === 'attributes' && m.attributeName === 'class') {
            if (!panelEl.classList.contains('hidden')) this._scheduleMiniMapInvalidate();
          }
        }
      });
      this._miniMapMutationObs.observe(panelEl, { attributes: true, attributeFilter: ['class'] });
      panelEl.addEventListener('transitionend', () => this._scheduleMiniMapInvalidate(), { passive: true });
    }

    // Window resize handler (light debounce via RAF)
    this._miniMapWindowResizeHandler && window.removeEventListener('resize', this._miniMapWindowResizeHandler);
    this._miniMapWindowResizeHandler = () => this._scheduleMiniMapInvalidate();
    window.addEventListener('resize', this._miniMapWindowResizeHandler, { passive: true });
  }

  // Sync mini-map + single scene coords input with current position
  _syncSingleSceneMiniMap(lat, lon) {
    if (this._singleMap) {
      this._singleMap.setView([lat, lon]);
      this._singleMapMarker?.setLatLng([lat, lon]);
    }
    const coordsInput = document.querySelector('#single-scene-coords');
    if (coordsInput) coordsInput.value = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  }

  _showSingleSceneLog() {
    const log = document.querySelector('#single-scene-log');
    if (log) log.classList.remove('hidden');
  }

  _logSingleScene(message) {
    const log = document.querySelector('#single-scene-log');
    if (log) {
      log.textContent += message + '\n';
      log.scrollTop = log.scrollHeight;
    }
    console.log('[Single Scene]', message);
  }

  /* Single-Scene helpers */
  _setSingleSceneVisibility(showVoxels) {
    const viewer = window.singleSceneViewer;
    const container = viewer?.tilesContainer;
    if (!viewer || !container) return;

    const vox = container.getObjectByName('singleSceneVoxels');
    container.children.forEach(ch => {
      if (vox && ch === vox) ch.visible = !!showVoxels;
      else ch.visible = !showVoxels;
    });
  }

  async _rebuildSingleSceneVoxels(resolution) {
    const viewer = window.singleSceneViewer;
    const container = viewer?.tilesContainer;
    if (!viewer || !container) { this._logSingleScene('❌ No tiles loaded'); return; }
  const rotDeg = parseInt(document.querySelector('#single-scene-rot')?.value || '0', 10) || 0; // degrees to sample at

    this._ssVoxVersion = (this._ssVoxVersion ?? 0) + 1;
    const myVersion = this._ssVoxVersion;

    // Remove old voxels
    const old = container.getObjectByName('singleSceneVoxels');
    if (old) {
      old.traverse(n => {
        if (n.isMesh) {
          n.geometry?.dispose();
          (Array.isArray(n.material) ? n.material : [n.material]).forEach(m => m?.dispose?.());
        }
      });
      container.remove(old);
      const i = viewer.voxelMeshes.indexOf(old);
      if (i >= 0) viewer.voxelMeshes.splice(i, 1);
    }

    // Show originals while rebuilding
    container.children.forEach(ch => { if (ch.name !== 'singleSceneVoxels') ch.visible = true; });

    this._logSingleScene(`🔄 (Re)voxelizing @ ${resolution}…`);
    container.updateMatrixWorld(true);

    let vox;
    try {
  vox = await voxelizeModel({ model: container, renderer: viewer.renderer, scene: viewer.scene, resolution, needGrid: false, preRotateYDeg: rotDeg });
    } catch (e) {
      this._logSingleScene(`❌ Voxelization error: ${e?.message || e}`);
      return;
    }

    if (myVersion !== this._ssVoxVersion) {
      // stale
      vox?.voxelMesh?.traverse(n => {
        if (n.isMesh) { n.geometry?.dispose(); (Array.isArray(n.material)?n.material:[n.material]).forEach(m=>m?.dispose?.()); }
      });
      return;
    }

    if (!vox || !vox.voxelMesh) {
      this._logSingleScene('❌ Voxelizer returned no geometry');
      return;
    }

    const voxelMesh = vox.voxelMesh;

    // Prepare counter-rotation so only sampling orientation changes
    const containerBox = new THREE.Box3().setFromObject(container);
    const pivot = containerBox.getCenter(new THREE.Vector3());
    const Tneg  = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
    const RyInv = new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(-rotDeg));
    const Tpos  = new THREE.Matrix4().makeTranslation( pivot.x,  pivot.y,  pivot.z);
    const counterM = new THREE.Matrix4().multiplyMatrices(Tpos, new THREE.Matrix4().multiplyMatrices(RyInv, Tneg));

    // world -> container-local + attach (after counter-rotation)
    const inv = new THREE.Matrix4().copy(container.matrixWorld).invert();
    voxelMesh.traverse(node => {
      if (node.isMesh && node.geometry) {
        if (rotDeg !== 0) node.geometry.applyMatrix4(counterM); // undo visual rotation
        node.geometry.applyMatrix4(inv);
        node.position.set(0,0,0);
        node.rotation.set(0,0,0);
        node.scale.set(1,1,1);
        node.updateMatrix();
        node.frustumCulled = false;
        try {
          node.geometry.computeBoundingBox?.();
          node.geometry.computeBoundingSphere?.();
        } catch {}
        try { node.layers.set(1); } catch {}
      }
    });

    voxelMesh.matrixAutoUpdate = false;
    voxelMesh.name = 'singleSceneVoxels';
    voxelMesh.userData.resolution = resolution;
    container.add(voxelMesh);
    viewer.voxelMeshes = [voxelMesh];
    viewer.voxelizer = vox;

    // Respect current toggle
    const on = document.querySelector('#single-scene-toggle-voxels')?.checked;
    this._setSingleSceneVisibility(!!on);

    this._logSingleScene(`✅ Voxels ready (${vox.voxelCount ?? '—'}) @ ${resolution}`);
  }

  _initializeBasicElements() {
    // Elements
    this.keyInput   = document.querySelector('#google-api-key');
    if (this.keyInput) {
      this.keyInput.value = localStorage.getItem('token') ?? '';
    }
    const saveBtn = document.querySelector('#save-settings');
    if (saveBtn) {
      saveBtn.onclick = () => {
        if (this.keyInput) {
          localStorage.setItem('token', this.keyInput.value.trim());
          toast('Saved API key');
          // Refresh tiles when API key changes
          this.refreshTiles();
        }
      };
    }

    this.coordsEl   = document.querySelector('#lat-lng');
    this.sseEl      = document.querySelector('#sse');
    this.status     = document.querySelector('#status-chip');
    this.footerHint = document.querySelector('#composer-hint');

    // Composer
    this.search     = document.querySelector('#place-search');
    this.sendBtn    = document.querySelector('#composer-send');

    // Suggestions + search results  
    this.suggestions = document.querySelector('#suggestions .composer');
    this.resultsWrap = document.querySelector('#search-results');
    this.resultsList = this.resultsWrap?.firstElementChild;

    // Vox controls (in drawer)
    this.toggleVox = document.querySelector('#toggle-vox');
    this.toggleMC  = document.querySelector('#toggle-mc');
    this.debugImageryRow = document.querySelector('#debug-imagery-row');
    this.toggleDebugImagery = document.querySelector('#toggle-debug-imagery');
    this.resPills  = [...document.querySelectorAll('.res-pill')];
    this.resFine   = document.querySelector('#res-fine');

    // Voxelization method controls
    this.voxelMethodRadios = [...document.querySelectorAll('input[name="voxel-method"]')];

    // Load saved voxelization method (default to 2.5d-scan)
    const savedMethod = localStorage.getItem('voxelMethod') || '2.5d-scan';
    this.voxelMethodRadios.forEach(radio => {
      radio.checked = radio.value === savedMethod;
    });

    // Load saved coords
    const saved = localStorage.getItem('coords');
    if (saved && this.coordsEl) this.coordsEl.value = saved;

    // Wire up UI (only if elements exist)
    if (this.suggestions) this._renderSuggestions();
    if (this.search && this.sendBtn) this._wireComposer();
    if (this.search) this._wireSearch();
    if (this.toggleVox) this._wireVoxUI();
    if (this.voxelMethodRadios.length) this._wireVoxelMethods();
    this._wireCameraControls();

    this.setStatus('Ready');
  }

  getKey()    { 
    if (this.keyInput && this.keyInput.value.trim()) {
      return this.keyInput.value.trim();
    }
    // Fallback to localStorage if input field is empty
    return localStorage.getItem('token') || '';
  }
  getSSE()    { return this.sseEl ? +this.sseEl.value : 20; }
  getLatLon() { 
    return this.coordsEl ? this.coordsEl.value.split(',').map(Number) : [37.7749, -122.4194]; 
  }
  log()       {}
  setLatLon([lat, lon]) {
    if (this.coordsEl) {
      this.coordsEl.value = `${lat.toFixed(4)},${lon.toFixed(4)}`;
      localStorage.setItem('coords', this.coordsEl.value);
    }
  // Reflect into Single Scene mini-map & input
  try { this._syncSingleSceneMiniMap(lat, lon); } catch {}
  }
  setStatus(t) { 
    if (this.status) this.status.textContent = t; 
    
    // Update footer citation based on status
    if (this.footerHint) {
      if (t.includes('Loading') || t.includes('Streaming')) {
        this.footerHint.textContent = '© Google Earth imagery';
      } else if (t.includes('API key')) {
        this.footerHint.textContent = 'Using free geocoder (Open-Meteo, fallback Nominatim)';
      } else {
        this.footerHint.textContent = '© Google Earth imagery';
      }
    }
  }
  onFetch = null;

  /* ─── Voxels panel ───────────────────────────────────────────── */
  _wireVoxUI() {
    const highlightResPill = (val) => {
      document.querySelectorAll('.res-pill').forEach(b => {
        b.classList.remove('bg-white','text-neutral-900');
        b.classList.add('opacity-80');
      });
      const active = document.querySelector(`.res-pill[data-res="${val}"]`);
      if (active) {
        active.classList.remove('opacity-80');
        active.classList.add('bg-white','text-neutral-900');
      }
    };

    // Set initial state - voxels ON by default
    state.vox = true;
    if (this.toggleVox) {
      this.toggleVox.checked = true;
    }
    if (this.toggleMC) {
      this.toggleMC.disabled = false;
    }
    highlightResPill(state.resolution);

    if (this.toggleVox) {
      this.toggleVox.addEventListener('change', e => {
        state.vox = e.target.checked;
        if (this.toggleMC) {
          this.toggleMC.disabled = !state.vox;
          if (!state.vox) {
            this.toggleMC.checked = false;
            state.mc = false;
          }
        }
        // Show/Hide Debug imagery row when voxel mode changes
        if (this.debugImageryRow) {
          this.debugImageryRow.style.display = state.vox ? '' : 'none';
        }
        if (!state.vox) {
          // Reset debugImagery when voxels are off
          state.debugImagery = false;
          if (this.toggleDebugImagery) this.toggleDebugImagery.checked = false;
        }
        updateVis();
      });
    }

    if (this.toggleMC) {
      this.toggleMC.addEventListener('change', e => {
        state.mc = e.target.checked;
        updateVis();
      });
    }

    if (this.toggleDebugImagery) {
      this.toggleDebugImagery.addEventListener('change', e => {
        state.debugImagery = e.target.checked;
        updateVis();
      });
    }

    this.resPills.forEach(btn => {
      btn.addEventListener('click', () => {
        const r = parseInt(btn.dataset.res, 10);
        state.resolution = r;
        if (this.resFine) this.resFine.value = r;
        highlightResPill(r);
        rebuildAll();
      });
    });

    if (this.resFine) {
      this.resFine.addEventListener('change', e => {
        const r = parseInt(e.target.value, 10);
        state.resolution = r;
        highlightResPill(r);
        rebuildAll();
      });
    }
  }

  /* ─── Voxelization Methods panel ─────────────────────────────── */
  _wireVoxelMethods() {
    this.voxelMethodRadios.forEach(radio => {
      radio.addEventListener('change', e => {
        if (e.target.checked) {
          localStorage.setItem('voxelMethod', e.target.value);
          console.log('Voxelization method changed to:', e.target.value);
          // Always trigger rebuild when method changes (user wants to see the difference)
          if (state.vox) {
            rebuildAll();
          }
        }
      });
    });
  }

  getVoxelizationMethod() {
    const selected = this.voxelMethodRadios.find(r => r.checked);
    return selected ? selected.value : '2.5d-scan'; // default fallback
  }

  refreshTiles() {
    if (tiles && tiles.layer) {
      // Force refresh of the Google Earth tiles layer
      tiles.layer.refresh();
    }
  }

  /* ─── Suggestions (chips above composer) ─────────────────────── */
  _renderSuggestions() {
    const PICKS = [
      { label:'Paris',         lat:48.85837, lon:2.29448, view:{height:360, tilt:45, heading:220} },
      { label:'New York',      lat:40.75800, lon:-73.98550, view:{height:360, tilt:48, heading: 30} },
      { label:'Tokyo',         lat:35.65858, lon:139.74543, view:{height:340, tilt:47, heading:-20} },
      { label:'Sydney',        lat:-33.85678, lon:151.21530, view:{height:360, tilt:43, heading:120} },
      { label:'Cairo',         lat:29.97923, lon:31.13420,  view:{height:420, tilt:38, heading:-140} },
      { label:'Rio de Janeiro',lat:-22.95192, lon:-43.21049,view:{height:340, tilt:43, heading:-20} },
      { label:'San Francisco', lat:37.81993, lon:-122.47825,view:{height:420, tilt:41, heading:  0} },
      { label:'London',        lat:51.50073, lon:-0.12463,  view:{height:340, tilt:46, heading:210} },
    ];
    this.suggestions.innerHTML = '';
    for (const p of PICKS) {
      const b = document.createElement('button');
      b.className = 'flex-shrink-0 rounded-lg bg-white/5 hover:bg-white/10 px-2 py-1 text-xs text-nowrap transition-all';
      b.textContent = p.label;
      b.onclick = () => {
        // Update the search input field with the selected location
        if (this.search) {
          this.search.value = p.label;
        }
        this._goTo(p.lat, p.lon, p.view);
      };
      this.suggestions.appendChild(b);
    }
  }

  /* ─── Bottom composer behavior ───────────────────────────────── */
  _wireComposer() {
    const tryLatLon = (s) => {
      const m = s.trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
      return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
    };

    // Update send button state based on input text
    const updateSendButton = () => {
      const hasText = this.search.value.trim().length > 0;
      if (hasText) {
        this.sendBtn.disabled = false;
        this.sendBtn.className = 'w-9 h-9 rounded-full flex items-center justify-center bg-white text-black hover:bg-white/90 transition-all cursor-pointer';
        this.sendBtn.querySelector('span').className = 'material-symbols-rounded material-bold text-lg';
      } else {
        this.sendBtn.disabled = true;
        this.sendBtn.className = 'w-9 h-9 rounded-full flex items-center justify-center bg-white/5 text-white/40 cursor-not-allowed transition-all';
        this.sendBtn.querySelector('span').className = 'material-symbols-rounded material-bold text-lg';
      }
    };

    // Initial state
    updateSendButton();

    // Update button state as user types
    this.search.addEventListener('input', updateSendButton);

    this.sendBtn.addEventListener('click', (e) => {
      if (this.sendBtn.disabled) {
        e.preventDefault();
        return;
      }

      const text = this.search.value.trim();
      if (!text) return;

      const maybe = tryLatLon(text);
      if (maybe) {
        this._goTo(maybe[0], maybe[1]);
      } else {
        // trigger geocode flow
        this._geocode(text, true);
      }
    });

    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !this.sendBtn.disabled) {
        this.sendBtn.click();
      }
    });
  }

  /* ─── Geocoder + results popup ───────────────────────────────── */
  _wireSearch() {
    const outsideClick = (e) => {
      const wrap = this.resultsWrap;
      if (!wrap.classList.contains('hidden') && !wrap.contains(e.target) && e.target !== this.search) {
        this._showResults(false);
      }
    };
    document.addEventListener('click', outsideClick);

    const deb = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };
    this.search.addEventListener('input', deb(() => {
      const q = this.search.value.trim();
      if (q.length < 3) return this._showResults(false);
      this._geocode(q, false);
    }, 250));
  }

  async _geocode(q, autoGo) {
    const render = (items) => {
      const list = this.resultsList;
      list.innerHTML = '';
      if (!items || !items.length) return this._showResults(false);
      for (const it of items) {
        const el = document.createElement('button');
        el.className = 'w-full text-left px-3 py-2 hover:bg-white/5 text-sm break-words';
        el.innerHTML = `<div class="font-medium truncate pr-2">${it.name}</div>
                        <div class="text-xs opacity-70 truncate pr-2">${it.addr}</div>`;
        el.onclick = () => { 
          // Update the search input field with the selected location name
          if (this.search) {
            this.search.value = it.name;
          }
          this._goTo(it.lat, it.lon); 
          this._showResults(false); 
        };
        list.appendChild(el);
      }
      this._showResults(true);
      if (autoGo) list.firstElementChild?.click();
    };

    // 1) Open-Meteo (free)
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`);
      if (r.ok) {
        const j = await r.json();
        if (j?.results?.length) {
          return render(j.results.map(f => ({
            name:f.name, addr:[f.admin1,f.country].filter(Boolean).join(', '),
            lat:f.latitude, lon:f.longitude
          })));
        }
      }
    } catch {}

    // 2) OSM Nominatim (fallback)
    try {
      const r2 = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=6&addressdetails=1`);
      if (r2.ok) {
        const j2 = await r2.json();
        return render(j2.map(f => ({
          name:f.display_name.split(',')[0],
          addr:f.display_name,
          lat: parseFloat(f.lat),
          lon: parseFloat(f.lon)
        })));
      }
    } catch {}

    render([]);
  }

  _showResults(on) {
    document.querySelector('#search-results').classList.toggle('hidden', !on);
  }

  _goTo(lat, lon, view) {
    this.setLatLon([lat, lon]);
    window.__desiredView = view || null; // add this line
    this.onFetch?.();
  }

  /* ─── Camera Controls ─────────────────────────────────────────── */
  _wireCameraControls() {
    let cameraMode = 'orbit'; // 'orbit' or 'freecam'
    let freecamKeys = { w: false, a: false, s: false, d: false, shift: false, space: false };
    let freecamSpeed = 100; // units per second
    let lastFrameTime = performance.now();
    
    // Mouse look variables for freecam
    let isMouseLocked = false;
    let mouseSensitivity = 0.002; // radians per pixel
    let yaw = 0; // horizontal rotation
    let pitch = 0; // vertical rotation
    let maxPitch = Math.PI / 2 - 0.1; // prevent gimbal lock
    
    // Get control elements
    const cameraModeBtn = document.querySelector('#camera-mode-btn');
    const compassBtn = document.querySelector('#compass-btn');
    const compassNeedle = document.querySelector('#compass-needle');
    const zoomInBtn = document.querySelector('#zoom-in-btn');
    const zoomOutBtn = document.querySelector('#zoom-out-btn');
    const tiltUpBtn = document.querySelector('#tilt-up-btn');
    const tiltDownBtn = document.querySelector('#tilt-down-btn');

    // Pointer lock for freecam mouse look
    const canvas = renderer.domElement;
    
    const requestPointerLock = () => {
      if (cameraMode === 'freecam' && !isMouseLocked) {
        canvas.requestPointerLock();
      }
    };

    const onPointerLockChange = () => {
      isMouseLocked = document.pointerLockElement === canvas;
    };

    const onMouseMove = (e) => {
      if (!isMouseLocked || cameraMode !== 'freecam') return;

      // Update yaw and pitch based on mouse movement
      yaw -= e.movementX * mouseSensitivity;
      pitch -= e.movementY * mouseSensitivity;
      pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));

      // Apply rotation to camera immediately
      if (camera) {
        camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
        
        // Update controls target to maintain orbit mode compatibility
        if (controls) {
          const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
          controls.target.copy(camera.position).add(direction.multiplyScalar(100));
        }
      }
    };

    // Add mouse event listeners
    canvas.addEventListener('click', requestPointerLock);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('mousemove', onMouseMove);

    // Exit pointer lock when switching to orbit mode
    const exitPointerLock = () => {
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
    };

    // Freecam keyboard controls
    const handleKeyDown = (e) => {
      if (cameraMode !== 'freecam') return;
      const key = e.key.toLowerCase();
      if (key === 'w') freecamKeys.w = true;
      if (key === 'a') freecamKeys.a = true;
      if (key === 's') freecamKeys.s = true;
      if (key === 'd') freecamKeys.d = true;
      if (key === 'shift') freecamKeys.shift = true;
      if (key === ' ') { freecamKeys.space = true; e.preventDefault(); }
      if (key === 'escape') exitPointerLock();
    };

    const handleKeyUp = (e) => {
      if (cameraMode !== 'freecam') return;
      const key = e.key.toLowerCase();
      if (key === 'w') freecamKeys.w = false;
      if (key === 'a') freecamKeys.a = false;
      if (key === 's') freecamKeys.s = false;
      if (key === 'd') freecamKeys.d = false;
      if (key === 'shift') freecamKeys.shift = false;
      if (key === ' ') freecamKeys.space = false;
    };

    // Add keyboard event listeners
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    // Freecam movement update (runs continuously in render loop)
    const updateFreecam = () => {
      if (cameraMode !== 'freecam' || !camera) return;

      const currentTime = performance.now();
      const deltaTime = (currentTime - lastFrameTime) / 1000;
      lastFrameTime = currentTime;

      // Check if any movement keys are pressed
      const hasMovement = freecamKeys.w || freecamKeys.a || freecamKeys.s || freecamKeys.d || freecamKeys.shift || freecamKeys.space;
      
      if (hasMovement) {
        const speed = freecamSpeed * deltaTime * (freecamKeys.shift ? 3 : 1);
        
        // Get camera direction vectors
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const up = new THREE.Vector3(0, 1, 0);

        // Calculate movement
        const movement = new THREE.Vector3();
        if (freecamKeys.w) movement.add(forward.clone().multiplyScalar(speed));
        if (freecamKeys.s) movement.add(forward.clone().multiplyScalar(-speed));
        if (freecamKeys.d) movement.add(right.clone().multiplyScalar(speed));
        if (freecamKeys.a) movement.add(right.clone().multiplyScalar(-speed));
        if (freecamKeys.space) movement.add(up.clone().multiplyScalar(speed));
        if (freecamKeys.shift && !freecamKeys.space) movement.add(up.clone().multiplyScalar(-speed/3));

        // Apply movement
        camera.position.add(movement);
        
        // Update controls target to maintain orbit mode compatibility
        if (controls) {
          const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
          controls.target.copy(camera.position).add(direction.multiplyScalar(100));
        }
      }
    };

    // Update compass needle rotation based on camera
    const updateCompass = () => {
      if (compassNeedle && camera) {
        const forward = new THREE.Vector3(0, 0, -1);
        forward.applyQuaternion(camera.quaternion);
        const angle = Math.atan2(forward.x, forward.z);
        const degrees = THREE.MathUtils.radToDeg(angle);
        compassNeedle.style.transform = `rotate(${-degrees}deg)`;
      }
    };

    // Update compass during camera movement and freecam
    if (controls) {
      controls.addEventListener('change', updateCompass);
    }

    // Add freecam update to render loop
    window.freecamUpdateFn = updateFreecam;

    // Camera Mode Toggle
    if (cameraModeBtn) {
      cameraModeBtn.addEventListener('click', () => {
        if (cameraMode === 'orbit') {
          // Switch to freecam mode
          cameraMode = 'freecam';
          if (controls) {
            controls.enabled = false; // Disable orbit controls
          }
          
          // Initialize freecam rotation from current camera orientation
          const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
          yaw = euler.y;
          pitch = euler.x;
          
          cameraModeBtn.querySelector('span').textContent = 'videocam';
          cameraModeBtn.title = 'Switch to Orbit Mode (Click canvas for mouse look)';
        } else {
          // Switch to orbit mode
          cameraMode = 'orbit';
          exitPointerLock(); // Exit pointer lock when switching to orbit
          
          if (controls) {
            controls.enabled = true;
            controls.enablePan = true;
            controls.screenSpacePanning = false;
            controls.mouseButtons = {
              LEFT: THREE.MOUSE.ROTATE,
              MIDDLE: THREE.MOUSE.DOLLY,
              RIGHT: THREE.MOUSE.PAN
            };
            // Update controls target to current camera look-at point
            const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
            controls.target.copy(camera.position).add(direction.multiplyScalar(100));
          }
          cameraModeBtn.querySelector('span').textContent = '360';
          cameraModeBtn.title = 'Switch to Freecam Mode (WASD + Mouse)';
        }
      });
    }

    // Compass Reset
    if (compassBtn) {
      compassBtn.addEventListener('click', () => {
        if (!camera) return;
        
        if (cameraMode === 'freecam') {
          // In freecam, just reset camera rotation to face north
          const currentPos = camera.position.clone();
          camera.position.copy(currentPos);
          camera.lookAt(currentPos.x, currentPos.y, currentPos.z - 100);
        } else if (controls) {
          // In orbit mode, reset to face north from current distance
          const currentPosition = camera.position.clone();
          const target = controls.target.clone();
          const distance = currentPosition.distanceTo(target);
          
          const newPosition = target.clone();
          newPosition.add(new THREE.Vector3(0, currentPosition.y - target.y, distance));
          
          // Smooth animation
          const startPos = currentPosition.clone();
          const startTime = performance.now();
          const duration = 500;
          
          const animate = (time) => {
            const elapsed = time - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            
            camera.position.lerpVectors(startPos, newPosition, eased);
            camera.lookAt(target);
            controls.update();
            updateCompass();
            
            if (progress < 1) {
              requestAnimationFrame(animate);
            }
          };
          requestAnimationFrame(animate);
        }
      });
    }

    // Zoom Controls
    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', () => {
        if (cameraMode === 'freecam') {
          freecamSpeed = Math.min(freecamSpeed * 1.25, 1000);
        } else if (controls) {
          const factor = 0.8;
          const distance = camera.position.distanceTo(controls.target);
          const newDistance = Math.max(distance * factor, controls.minDistance);
          
          const direction = camera.position.clone().sub(controls.target).normalize();
          camera.position.copy(controls.target).add(direction.multiplyScalar(newDistance));
          controls.update();
        }
      });
    }

    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', () => {
        if (cameraMode === 'freecam') {
          freecamSpeed = Math.max(freecamSpeed * 0.8, 10);
        } else if (controls) {
          const factor = 1.25;
          const distance = camera.position.distanceTo(controls.target);
          const newDistance = Math.min(distance * factor, controls.maxDistance);
          
          const direction = camera.position.clone().sub(controls.target).normalize();
          camera.position.copy(controls.target).add(direction.multiplyScalar(newDistance));
          controls.update();
        }
      });
    }

    // Tilt Controls
    if (tiltUpBtn) {
      tiltUpBtn.addEventListener('click', () => {
        if (cameraMode === 'freecam') {
          camera.rotateX(-0.1);
        } else if (controls && camera) {
          const target = controls.target;
          const position = camera.position.clone();
          const direction = position.sub(target);
          
          const axis = new THREE.Vector3().crossVectors(direction, camera.up).normalize();
          const angle = -0.2;
          direction.applyAxisAngle(axis, angle);
          
          camera.position.copy(target).add(direction);
          camera.lookAt(target);
          controls.update();
        }
      });
    }

    if (tiltDownBtn) {
      tiltDownBtn.addEventListener('click', () => {
        if (cameraMode === 'freecam') {
          camera.rotateX(0.1);
        } else if (controls && camera) {
          const target = controls.target;
          const position = camera.position.clone();
          const direction = position.sub(target);
          
          const axis = new THREE.Vector3().crossVectors(direction, camera.up).normalize();
          const angle = 0.2;
          direction.applyAxisAngle(axis, angle);
          
          camera.position.copy(target).add(direction);
          camera.lookAt(target);
          controls.update();
        }
      });
    }

    // Initial compass update
    updateCompass();
  }

  // single-scene map initialized earlier; duplicate removed
}

/* helpers */
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'fixed top-4 right-4 glass elev rounded-xl px-3 py-2 text-sm z-[60]';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1400);
}

// Static attribution; avoid extra root.json fetches that count toward quota
function updateAttributionFromTileset() {
  const hint = document.querySelector('#composer-hint');
  if (hint) {
    hint.innerHTML = `© Google Maps · <a href="https://maps.google.com/help/terms_maps" target="_blank" rel="noopener noreferrer" class="underline opacity-80 hover:opacity-100">Terms</a>`;
  }
}

// Initialize everything when DOM is ready
let ui;
function initializeApp() {
  // Add a small delay to ensure all DOM elements are fully rendered
  setTimeout(() => {
    ui = new HUD();
    
    // Set up UI callbacks after UI is ready
    if (ui && ui.getKey()) {
      console.log('got key from localStorage; starting tiles');
      const [lat, lon] = ui.getLatLon();
      const key = ui.getKey();
      const root = `https://tile.googleapis.com/v1/3dtiles/root.json?key=${key}`;
      ui.setStatus('Loading tiles...');
  updateAttributionFromTileset();
      ensureTiles(root, key);
      retargetTiles(lat, lon);
    }

    if (ui) {
      ui.onFetch = () => {
        const key = ui.getKey();
        if (!key) { ui.setStatus('🔑 API key required'); toast('Add your Google API key in Settings'); return; }
        const [lat, lon] = ui.getLatLon();
        const root = `https://tile.googleapis.com/v1/3dtiles/root.json?key=${key}`;

  ui.setStatus(`Streaming ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
  updateAttributionFromTileset();        // no network call
  ensureTiles(root, key);
  retargetTiles(lat, lon);
      };
    }
  }, 100);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}

/* ───────────────────────────────  Three.js set-up ─────────────────── */
let scene,camera,controls,renderer,tiles=null;
let tilesSessionId = null; // session from first root load (reused across requests)
let isInteracting = false;
let __desiredView = null; // populated by HUD._goTo
let freecamUpdateFn = null; // Will be set by camera controls
let hasFramedOnce = false; // gate initial auto-framing

/* ─────────────────────────────────── GUI & state ──────────────────── */
const LAYER_IMAGERY = 0;   // Google 3D Tiles
const LAYER_VOXELS  = 1;   // Our voxel meshes / MC

const state = { resolution: 64, vox: true, mc: false, debugImagery: false };
let lastVoxelUpdateTime = 0;

(() => {
  // Stable, zero-stutter baseline: WebGL. Re-enable WebGPU later if desired.
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance'
  });
  document.body.appendChild(renderer.domElement);

  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x151c1f);
  const hemi = new THREE.HemisphereLight(0xffffff,0x202020,1);
  scene.add(hemi);
  // Lights affect both layers
  hemi.layers.enable(LAYER_IMAGERY);
  hemi.layers.enable(LAYER_VOXELS);

  camera=new THREE.PerspectiveCamera(60,1,0.1,1_600_000);
  // Camera can render both layers; we'll toggle them later
  camera.layers.enable(LAYER_IMAGERY);
  camera.layers.enable(LAYER_VOXELS);
  controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true; controls.maxDistance=3e4;

  controls.addEventListener('start', () => {
    isInteracting = true;
    // Keep consistent LOD while moving - voxel caching handles performance now
  });
  
  controls.addEventListener('end', () => {
    isInteracting = false;
    // No need to restore errorTarget since we don't change it
  });

  window.addEventListener('resize',resize); resize();
  
  requestAnimationFrame(loop);
})();

function resize(){
  const w=innerWidth,h=innerHeight;
  camera.aspect=w/h; camera.updateProjectionMatrix();
  renderer.setSize(w,h);
  renderer.setPixelRatio(Math.min(1.25, window.devicePixelRatio));
}

/* ───────────────────────────── TilesRenderer factory ──────────────── */
function frameToView(view = { height: 360, tilt: 60, heading: 0 }) {
  const tilt    = THREE.MathUtils.degToRad(view.tilt    ?? 60);
  const heading = THREE.MathUtils.degToRad(view.heading ?? 0);
  const r       = view.height ?? 360;
  const horiz = Math.cos(tilt) * r;
  const up    = Math.sin(tilt) * r;
  const x     = Math.cos(heading) * horiz;
  const z     = Math.sin(heading) * horiz;

  controls.target.set(0, 0, 0);
  camera.position.set(x, up, z);
  controls.minDistance = 10;
  controls.maxDistance = 30000;
  controls.update();
}

function ensureTiles(root,key){
  if (tiles) return;
  tiles=new TilesRenderer(root);
  tiles.registerPlugin(new TileCompressionPlugin());
  tiles.registerPlugin(new TilesFadePlugin());
  tiles.registerPlugin(new GLTFExtensionsPlugin({
    dracoLoader:new DRACOLoader()
      .setDecoderPath('https://unpkg.com/three@0.160/examples/jsm/libs/draco/gltf/')
  }));

  // Prefer browser HTTP cache (honors server Cache-Control/ETag)
  tiles.fetchOptions = { cache: 'force-cache' };

  // keep single session id and key everywhere
  tiles.preprocessURL = u=>{
    if(u.startsWith('blob:')||u.startsWith('data:')) return u;
    const url=new URL(u,'https://tile.googleapis.com');
    if(url.searchParams.has('session')) tilesSessionId=url.searchParams.get('session');
    if(tilesSessionId && !url.searchParams.has('session')) url.searchParams.set('session',tilesSessionId);
    if(!url.searchParams.has('key'))     url.searchParams.set('key',key);
    return url.toString();
  };

  tiles.errorTarget = ui ? ui.getSSE() : 20;
  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera,renderer);

  // Events (no auto-framing here; 'load-tile-set' fires multiple times for nested sets)
  tiles.addEventListener('load-model', onTileLoad);
  tiles.addEventListener('dispose-model', onTileDispose);
  // LOD visibility management
  tiles.addEventListener('tile-visibility-change', ({ tile, visible }) => {
    const tileGroup = tile.cached.scene;
    if (!tileGroup) return;
    tileGroup.userData.rendererVisible = visible;
    if (visible) {
      if (state.vox && !isInteracting && !tileGroup._voxMesh && !tileGroup._mcMesh && !voxelizingTiles.has(tileGroup) && !disposingTiles.has(tileGroup)) {
        buildVoxelFor(tileGroup);
      }
    } else {
      try { tileGroup._voxWorker?.terminate?.(); } catch {}
      voxelizingTiles.delete(tileGroup);
      if (tileGroup._voxMesh) tileGroup._voxMesh.visible = false;
      if (tileGroup._mcMesh) tileGroup._mcMesh.visible = false;
    }
    applyVis(tileGroup);
  });

  scene.add(tiles.group);
}

function retargetTiles(latDeg,lonDeg){
  if(!tiles) return;
  tiles.setLatLonToYUp(
    latDeg * THREE.MathUtils.DEG2RAD,
    lonDeg * THREE.MathUtils.DEG2RAD
  );
  // Frame only when explicitly requested (search/geocode) or first ever.
  const requested = (window.__desiredView || __desiredView) || null;
  if (requested) {
    frameToView(requested);
    window.__desiredView = __desiredView = null;
    hasFramedOnce = true;
  } else if (!hasFramedOnce) {
    frameToView();
    hasFramedOnce = true;
  }
  // Keep Single Scene mini-map centered with main map moves
  try { ui?._syncSingleSceneMiniMap?.(latDeg, lonDeg); } catch {}
}

// Back-compat wrapper for any remaining call sites
function spawnTiles(root,key,latDeg,lonDeg){
  ensureTiles(root,key);
  retargetTiles(latDeg,lonDeg);
}

// (tile-visibility-change listener now registered inside ensureTiles())

/* ───────────────────── helper to dispose THREE objects ───────────── */
function dispose(o){
  if(!o) return;
  if(o.userData && o.userData.sourceTile) {
    const tile = o.userData.sourceTile;
    if(tile._voxMesh === o) delete tile._voxMesh;
    if(tile._mcMesh === o) delete tile._mcMesh;
    delete o.userData.sourceTile;
  }
  
  if(o.traverse && typeof o.traverse === 'function') {
    o.traverse(n=>{
      if(n.isMesh){
        n.geometry?.dispose();
        (Array.isArray(n.material)?n.material:[n.material])
          .forEach(m=>{
            if(m) {
              m.map?.dispose();
              m.dispose();
            }
          });
      }
    });
  } else if(o.isMesh) {
    o.geometry?.dispose();
    (Array.isArray(o.material)?o.material:[o.material])
      .forEach(m=>{
        if(m) {
          m.map?.dispose();
          m.dispose();
        }
      });
  }
  o.parent?.remove(o);
}

/* ───────────────────── per-tile voxel / MC logic ──────────────────── */

const voxelizingTiles = new Set();
const disposingTiles = new Set();

// --- New: distance-aware resolution & concurrency budget ---
const CPU = (navigator.hardwareConcurrency || 4);
const MAX_CONCURRENT_VOXELIZERS = Math.max(1, Math.min(4, Math.floor(CPU / 2)));
const MOVING_BUDGET = 1; // keep UI smooth while the camera is in motion
const TARGET_PX_PER_VOXEL       = 3;     // tweak to taste (2..4 is a good band)

function screenRadiusForObject(obj) {
  // estimate object radius in world units
  const box = new THREE.Box3().setFromObject(obj);
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);

  const dist = camera.position.distanceTo(sphere.center);
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const pxPerUnit = renderer.domElement.height / (2 * Math.tan(vFov / 2));
  return (sphere.radius * pxPerUnit) / Math.max(1e-3, dist); // pixels
}

function resolutionForTile(tile) {
  const pxRadius = screenRadiusForObject(tile);
  // translate pixels → voxels; clamp to GUI slider as an upper bound
  const r = Math.round(pxRadius / TARGET_PX_PER_VOXEL);
  return THREE.MathUtils.clamp(r, 8, state.resolution);
}

async function buildVoxelFor(tile){
  const rendererVisible = tile?.userData?.rendererVisible ?? tile?.visible ?? false;
  if(!tile || tile._voxMesh || tile._voxError || voxelizingTiles.has(tile) || disposingTiles.has(tile) || !rendererVisible) return;
  if(!tile.parent || tile.parent !== tiles.group) return;
  
  let hasMeshes = false;
  tile.traverse(n => { if(n.isMesh && n.geometry) hasMeshes = true; });
  if(!hasMeshes) return;
  
  // Skip giant parent tiles when we're close (they'll refine into children)
  const s = new THREE.Sphere();
  tile.getWorldPosition(s.center);
  tile.getWorldScale(s);           // crude scale proxy
  const approxRadius = tile.boundingSphere?.radius || Math.max(s.x, s.y, s.z) * 50;
  const dist2 = camera.position.distanceToSquared(s.center);
  if (approxRadius * approxRadius > dist2 * 0.6) return;
  
  voxelizingTiles.add(tile);
  try{
    const perTileResolution = resolutionForTile(tile);
    let workerRef = null;
    const vox = await voxelizeModel({
      model: tile,
      resolution: perTileResolution,
      needGrid: true,   // always build voxelGrid so MC toggle is instant
      method: ui.getVoxelizationMethod(),
      onStart: w => { workerRef = w; tile._voxWorker = w; }
    });
    
    if(!tile.parent || tile.parent !== tiles.group || disposingTiles.has(tile)) {
      try { workerRef?.terminate?.(); } catch{} 
      dispose(vox.voxelMesh); 
      return;
    }

  const vMesh = vox.voxelMesh;
    vMesh.matrixAutoUpdate = false;
    vMesh.userData.sourceTile = tile;
    
    // assign smaller renderOrder for nearer chunks (better early-Z)
    vMesh.traverse(m=>{
      if (!m.isMesh) return;
      const bb = m.geometry.boundingBox;
      if (bb) {
        const c = bb.getCenter(new THREE.Vector3());
        m.renderOrder = -camera.position.distanceToSquared(c);
      }
    });
    
    // Put voxels on the voxel layer
    vMesh.traverse(n => n.layers.set(LAYER_VOXELS));
    scene.add(vMesh);

    tile._voxMesh = vMesh;
    tile._voxelizer = vox;
    // Remember original materials for MC toggle
    vMesh.traverse(n => { if(n.isMesh && !n.userData.origMat) n.userData.origMat = n.material; });

    if(state.mc && vox._voxelGrid) {
      await applyAtlasToExistingVoxelMesh(vMesh, vox._voxelGrid);
      tile._mcApplied = true;
    }
    applyVis(tile);
  }catch(e){ 
    console.warn('voxelise failed',e);
    tile._voxError = true; // prevent infinite retry spam this session
  } finally {
    voxelizingTiles.delete(tile);
  }
}

async function buildMinecraftFor(tile){
  // Backwards-compat helper: apply atlas material if not already applied
  if(!tile || !tile._voxMesh || !tile._voxelizer || disposingTiles.has(tile)) return;
  if(tile._mcApplied) return;
  try {
    if (!tile._voxelizer._voxelGrid) return; // needGrid must be true during voxelization when MC enabled
    await applyAtlasToExistingVoxelMesh(tile._voxMesh, tile._voxelizer._voxelGrid);
    tile._mcApplied = true;
    applyVis(tile);
  } catch(e) { console.warn('Minecraft material swap failed', e); }
}

// The 'scene' from the event is the THREE.Group for the tile.
function onTileLoad({scene:tile}){
  if(!tile || !tile.parent || tile.parent !== tiles.group || tile.type !== 'Group') return;
  tile.updateMatrixWorld(true);

  // All original meshes live on the imagery layer
  tile.traverse(n => n.layers.set(LAYER_IMAGERY));

  // The complex 'cleanupOverlappingVoxels' is no longer needed.
  // The 'tile-visibility-change' event now handles removing voxels from
  // parent tiles when children (higher LODs) are loaded.
  applyVis(tile);
  
  // Automatically voxelize if vox mode is on.
  const rendererVisible = tile?.userData?.rendererVisible ?? tile.visible;
  if(state.vox && !isInteracting && rendererVisible && !tile._voxMesh && !tile._voxError && !voxelizingTiles.has(tile)) {
    requestAnimationFrame(() => {
      const stillVisible = tile?.userData?.rendererVisible ?? tile.visible;
      if(!isInteracting && tile.parent && stillVisible && !tile._voxMesh && !tile._voxError && !voxelizingTiles.has(tile) && !disposingTiles.has(tile)) {
        buildVoxelFor(tile);
      }
    });
  }
}

// The 'scene' from the event is the THREE.Group for the tile.
function onTileDispose({scene:tile}){
  if(tile) {
    disposingTiles.add(tile);
    cleanupTileVoxels(tile);
    disposingTiles.delete(tile);
  }
}

function cleanupTileVoxels(tile){
  if(!tile) return;
  
  disposingTiles.add(tile);
  try {
    try { tile._voxWorker?.terminate?.(); } catch {}
  dispose(tile._voxMesh); 
  dispose(tile._tempContainer);
    
    voxelizingTiles.delete(tile);
    
  delete tile._voxMesh;
  delete tile._voxelizer;
  delete tile._tempContainer;
  delete tile._voxError;  // allow retry after cleanup
  delete tile._voxWorker;
  delete tile._mcApplied;
  } finally {
    disposingTiles.delete(tile);
  }
}



function applyVis(tile){
  if(!tile || !tile.parent || tile.parent !== tiles.group || typeof tile.type !== 'string') return;

  const showVoxels   = state.vox;
  const useMinecraft = state.vox && state.mc;
  const hideImagery  = state.vox && (state.debugImagery === false);

  if (hideImagery) {
    camera.layers.disable(LAYER_IMAGERY);
    camera.layers.enable(LAYER_VOXELS);
  } else {
    camera.layers.enable(LAYER_IMAGERY);
    if (state.vox) camera.layers.enable(LAYER_VOXELS); else camera.layers.disable(LAYER_VOXELS);
  }

  if (tile._voxMesh) tile._voxMesh.visible = !!showVoxels;

  if (tile._voxMesh) {
    if (useMinecraft) {
      if (!tile._mcApplied && tile._voxelizer?._voxelGrid) {
        buildMinecraftFor(tile);
      } else {
        tile._voxMesh.traverse(n=>{ if(n.isMesh && n.userData?.mcMat) n.material = n.userData.mcMat; });
      }
    } else {
      tile._voxMesh.traverse(n=>{ if(n.isMesh && n.userData?.origMat) n.material = n.userData.origMat; });
    }
  }
}

// Recompute per-tile visibility & (re)voxelization needs after UI state changes.
// Called by UI event handlers when toggling vox / mc / debug imagery.
function updateVis(){
  if(!tiles || !tiles.group) return;
  tiles.group.children.forEach(tile => { if(tile && tile.type==='Group') applyVis(tile); });
}


function rebuildAll(){
  if(!tiles || !tiles.group) return;
  
  if (tiles.group.children) {
    const tilesToClean = tiles.group.children.filter(child =>
      child && (child._voxMesh || child._mcMesh)
    );
    tilesToClean.forEach(cleanupTileVoxels);
  }
  
  voxelizingTiles.clear();
  disposingTiles.clear();
  
  updateVis();
}

/* ───────────────────────── render loop ───────────────────────────── */
const VOXEL_UPDATE_INTERVAL = 300;

function loop(){
  requestAnimationFrame(loop);
  
  // Update freecam if enabled
  if (window.freecamUpdateFn) {
    window.freecamUpdateFn();
  }
  
  controls.update();
  
  if(tiles){ 
    camera.updateMatrixWorld(); 
    tiles.update();
    
    // This periodic check is a good fallback to catch any visible tiles
    // that slipped through the event-based voxelization.
    const now = performance.now();
    if(state.vox && !isInteracting && now - lastVoxelUpdateTime > VOXEL_UPDATE_INTERVAL) {
      lastVoxelUpdateTime = now;
      
      if(tiles.group && tiles.group.children) {
        const tilesToVoxelize = [];
        tiles.group.children.forEach(tile => {
          const rendererVisible = tile?.userData?.rendererVisible ?? tile?.visible;
          if (tile && tile.type === 'Group' && rendererVisible && !tile._voxMesh && !tile._voxError && !voxelizingTiles.has(tile) && !disposingTiles.has(tile)) {
            tilesToVoxelize.push(tile);
          }
        });
        
        if (tilesToVoxelize.length > 0) {
          const camPos = camera.position;
          tilesToVoxelize.sort((a, b) => {
            const aPos = new THREE.Vector3();
            const bPos = new THREE.Vector3();
            a.getWorldPosition(aPos);
            b.getWorldPosition(bPos);
            return aPos.distanceToSquared(camPos) - bPos.distanceToSquared(camPos);
          });
          
          const budget = Math.max(
            0, (isInteracting ? MOVING_BUDGET : MAX_CONCURRENT_VOXELIZERS) - voxelizingTiles.size
          );
          tilesToVoxelize.slice(0, budget).forEach(tile => buildVoxelFor(tile));
        }
      }
    }
  }
  
  renderer.render(scene,camera);
}