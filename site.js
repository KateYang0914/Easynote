let historyStack = [] // 存放過去的紀錄
let redoStack = [] // 存放被復原的紀錄，供重做使用
const maxHistory = 50 // 最多存 50 步，避免記憶體爆掉

let boards = JSON.parse(localStorage.getItem('milanote_v5')) || { root: [] }
let currId = 'root'
let paths = [{ id: 'root', name: 'HOME' }]
let activeCard = null,
  offset = { x: 0, y: 0 },
  cropper = null,
  cropTargetId = null,
  selectedId = null,    // 當前選取的卡片 ID
  clipboard = null      // 剪貼簿容器

let highestZ = 1000;

// 提升卡片層級，解決縮放鈕或拖曳時被其他卡片遮擋的問題
function bringToFront(card) {
  highestZ++;
  card.style.zIndex = highestZ;
}

// 提供給 HTML 按鈕使用的復原函式
function triggerUndo() {
  // 如果正在編輯文字，執行瀏覽器內建的文字復原
  if (document.activeElement.contentEditable === 'true' || document.activeElement.tagName === 'INPUT') {
    document.execCommand('undo', false, null);
  } else {
    // 否則執行畫布（卡片）的復原
    undo();
  }
}

// 提供給 HTML 按鈕使用的重做函式
function triggerRedo() {
  if (document.activeElement.contentEditable === 'true' || document.activeElement.tagName === 'INPUT') {
    document.execCommand('redo', false, null);
  } else {
    redo();
  }
}

function save() {
  // 1. 本地備份（保險用）
  localStorage.setItem('milanote_v5', JSON.stringify(boards))
  // 2. 雲端同步（真正的跨平台核心）
  // 我們不需要 await 它，讓它在背景慢慢傳，不卡住使用者操作
  syncBoardsToTable()
}

async function manualSave() {
  const btn = document.getElementById('save-btn')

  // 1. 開始動畫
  btn.classList.add('saving')
  btn.innerText = '⏳' // 變換圖示

  try {
    // 2. 執行雲端同步 (呼叫你原本在 supabase-logic.js 的函式)
    // 建議確保 syncBoardsToTable 有回傳 Promise 或是改寫成 async
    await syncBoardsToTable()

    // 3. 儲存成功後的回饋
    btn.innerText = '✅'
    console.log('手動同步完成！')
  } catch (err) {
    btn.innerText = '❌'
    alert('同步失敗，請檢查網路連線')
  } finally {
    // 4. 2秒後恢復原狀
    setTimeout(() => {
      btn.classList.remove('saving')
      btn.innerText = '☁️'
    }, 2000)
  }
}

// 在執行任何動作前，先呼叫這個來「拍照」
function recordHistory() {
  // 儲存目前 boards 的深層複製，避免同步更動
  historyStack.push(JSON.stringify(boards))
  if (historyStack.length > maxHistory) historyStack.shift() // 超過 50 步就丟掉舊的
  redoStack = [] // 只要使用者執行了新動作，就清空重做棧
}

// 執行復原
function undo() {
  if (historyStack.length > 0) {
    redoStack.push(JSON.stringify(boards)) // 將當前狀態放入重做棧
    const lastState = historyStack.pop()
    boards = JSON.parse(lastState)
    save()
    render()
  } else {
    console.log('已經沒有上一步了')
  }
}

// 執行重做
function redo() {
  if (redoStack.length > 0) {
    historyStack.push(JSON.stringify(boards)) // 將當前狀態放回歷史棧
    const nextState = redoStack.pop()
    boards = JSON.parse(nextState)
    save()
    render()
  } else {
    console.log('已經是最新狀態了')
  }
}

function render() {
  const canvas = document.getElementById('canvas')
  canvas.innerHTML = ''
  
  // 1. 更新導覽路徑
  const navPath = document.getElementById('nav-path')
  navPath.innerHTML = ''

  // 點擊畫布空白處取消選取
  canvas.onmousedown = (e) => {
    if (e.target === canvas) {
      selectedId = null
      render()
    }
  }

  paths.forEach((p, i) => {
    const span = document.createElement('span')
    span.className = 'path-item'
    span.textContent = p.name
    span.onclick = () => jump(i)
    navPath.appendChild(span)

    if (i < paths.length - 1) {
      const sep = document.createElement('span')
      sep.className = 'path-sep'
      sep.textContent = '>'
      navPath.appendChild(sep)
    }
  })

  // 2. 獲取模板
  const template = document.getElementById('card-template')

  ;(boards[currId] || []).forEach(item => {
    const clone = template.content.cloneNode(true)
    const card = clone.querySelector('.card')
    const handle = clone.querySelector('.handle')
    const delBtn = clone.querySelector('.del')
    const resizer = clone.querySelector('.resizer')

    // 設定卡片基礎屬性
    card.className = `card ${item.type}-card`
    card.dataset.id = item.id
    card.style.cssText = `left:${item.x}px; top:${item.y}px; width:${item.w}px; height:${item.h}px;`
    
    // 如果是被選取的卡片，加上 class
    if (item.id === selectedId) card.classList.add('selected')
    
    card.addEventListener('mousedown', (e) => {
      // 更新選取狀態，並立即給予視覺回饋
      document.querySelectorAll('.card.selected').forEach(el => el.classList.remove('selected'))
      selectedId = item.id
      card.classList.add('selected')

      // 如果目前有文字框在編輯中，強迫它失去焦點，這樣熱鍵才會對準卡片
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur()
    })

    // 綁定基本事件
    handle.onmousedown = (e) => drag(e, card)
    handle.ontouchstart = (e) => drag(e, card)

    const delHandler = (e) => {
      e.stopPropagation()
      if (e.cancelable) e.preventDefault()
      del(item.id)
    }
    delBtn.onclick = delHandler
    delBtn.ontouchstart = delHandler

    resizer.onmousedown = (e) => initResize(e, card)
    resizer.ontouchstart = (e) => initResize(e, card)

    // 3. 根據類型填充內容
    let contentNode = null

    if (item.type === 'note') {
      contentNode = document.createElement('div')
      contentNode.className = 'body'
      contentNode.contentEditable = 'true'
      contentNode.innerHTML = item.content
      contentNode.oninput = () => upd(item.id, 'content', contentNode.innerHTML)

    } else if (item.type === 'page') {
      contentNode = document.createElement('div')
      contentNode.className = 'page-link'
      contentNode.ondblclick = () => enter(item.subId, item.content)

      const pageInput = document.createElement('div')
      pageInput.className = 'page-input'
      pageInput.contentEditable = 'true'
      pageInput.style.cssText = `text-align:center; font-weight:bold; cursor:text; outline:none; width:85%; font-size:${item.fontSize || '18px'}; min-height:1.2em;`
      pageInput.innerHTML = item.content
      
      pageInput.onmousedown = (e) => e.stopPropagation()
      pageInput.oninput = (e) => handlePageInput(e.target)
      
      const openLabel = document.createElement('div')
      openLabel.style.cssText = 'font-size:14px; color:#999; margin-top:5px; pointer-events:none; font-weight:bold;'
      openLabel.textContent = 'OPEN'

      contentNode.appendChild(pageInput)
      contentNode.appendChild(openLabel)

    } else if (item.type === 'image') {
      contentNode = document.createElement('div')
      contentNode.className = 'image-container'
      contentNode.onclick = () => openCrop(item.id, item.content)
      
      const img = document.createElement('img')
      img.src = item.content
      contentNode.appendChild(img)
    }

    if (contentNode) {
      card.insertBefore(contentNode, resizer)
    }

    canvas.appendChild(clone)
  })
}

// 寫在 script 標籤內的任何地方即可
function savePageContent(el, id) {
  // 直接抓取元素內部的 HTML，這樣就不會受到字串引號的干擾
  upd(id, 'content', el.innerHTML)
}

function handlePageInput(el) {
  const id = el.closest('.card').dataset.id
  // 使用 innerHTML 以保留 B/I 格式，但透過 this 傳遞，避開 HTML 字串拼接的引號衝突
  upd(id, 'content', el.innerHTML)
}

function changeSize(size) {
  recordHistory()
  const sel = window.getSelection()
  if (!sel.rangeCount) return

  const container = sel.getRangeAt(0).commonAncestorContainer
  const parent = container.nodeType === 3 ? container.parentElement : container

  // 現在我們檢查是不是點到 class 為 page-input 的 div
  const pageTitle = parent.closest('.page-input')

console.log('pageTitle', pageTitle)

  if (pageTitle) {
    pageTitle.style.fontSize = size
    const id = pageTitle.closest('.card').dataset.id
    upd(id, 'fontSize', size) // 儲存大小
  } else {
    // 一般筆記維持原樣
    const cmdSize = size === '16px' ? '3' : size === '24px' ? '5' : '7'
    document.execCommand('fontSize', false, cmdSize)
  }
  save()
}

document.addEventListener('selectionchange', () => {
  const selection = window.getSelection()
  const toolbar = document.getElementById('toolbar')

  // 1. 檢查是否有選取文字
  if (selection.rangeCount > 0 && selection.toString().trim().length > 0) {
    const range = selection.getRangeAt(0)
    const container = range.commonAncestorContainer
    const parent = container.nodeType === 3 ? container.parentElement : container

    // 2. 判斷是否在「筆記本區」或「頁面標題區」選字
    // 注意：現在標題也是 div 且類名是 page-input
    const isNote = parent.closest('.body')
    const isPageTitle = parent.closest('.page-input')

    if (isNote || isPageTitle) {
      const rect = range.getBoundingClientRect()

      if (rect.width > 0) {
        toolbar.style.display = 'flex'
        // 使用 getBoundingClientRect 的絕對位置，不再加 window.scrollY 避免偏移
        toolbar.style.top = rect.top - 55 + 'px'
        toolbar.style.left = rect.left + 'px'
        return
      }
    }
  }
  // 不符合條件則隱藏
  toolbar.style.display = 'none'
})

function addItem(type, content = '') {
  recordHistory()
  const id = 'id_' + Date.now()
  const item = { id, type, x: 100, y: 100, w: 200, h: 200, content: content || (type === 'page' ? '新頁面' : ''), subId: type === 'page' ? 'b_' + id : null }
  // 確保當前看板存在，避免 push 到 undefined
  if (!boards[currId]) boards[currId] = []
  boards[currId].push(item)
  if (type === 'page') boards[item.subId] = []
  save()
  render()
}

function clearFullPage() {
  // 1. 先確認使用者是不是真的要清空
  const confirmed = confirm('確定要清空這一頁的所有內容嗎？\n(此動作可以透過 Ctrl+Z 復原)')

  if (confirmed) {
    // 2. 動作前先拍照存入歷史紀錄，這樣萬一後悔還能 Ctrl+Z 救回來
    if (typeof recordHistory === 'function') recordHistory()

    // 3. 將目前頁面的陣列清空
    boards[currId] = []

    // 4. 存檔並重新渲染
    save()
    render()
  }
}

async function handleImg(e) {
  const file = e.target.files[0]
  if (!file) return

  // 1. 顯示一點簡單的提示（或者可以做個 Loading 動畫）
  const originalBtn = e.target.parentElement
  console.log('正在上傳圖片中，請稍候...')

  // 2. 呼叫我們在 supabase-logic.js 寫的雲端上傳函式
  const cloudUrl = await uploadImageToCloud(file)

  if (cloudUrl) {
    // 3. 成功拿到網址後，呼叫原本的 addItem
    // 這時候 content 存的是 "https://..." 而不是超長的 base64 碼
    addItem('image', cloudUrl)
    console.log('圖片已加入畫布！')
  } else {
    alert('圖片上傳雲端失敗，請檢查網路或 Supabase Policy 設定')
  }

  // 重置 input 以便下次選擇同一個檔案
  e.target.value = ''
}

function openCrop(id, src) {
  cropTargetId = id
  const modal = document.getElementById('crop-modal')
  const img = document.getElementById('crop-img')
  modal.style.display = 'flex'
  // --- 關鍵修正：加上這行，裁切雲端圖片才不會報錯 ---
  img.crossOrigin = 'anonymous'
  // ------------------------------------------
  img.src = src
  img.onload = () => {
    if (cropper) cropper.destroy()
    cropper = new Cropper(img, { viewMode: 1 })
  }
}

async function doCrop() {
  recordHistory()

  // 1. 取得裁切後的畫布
  const canvas = cropper.getCroppedCanvas({ maxWidth: 1024, maxHeight: 1024 })

  // 2. 將畫布轉成 Blob（檔案格式），準備上傳
  canvas.toBlob(
    async blob => {
      const fileName = `cropped_${Date.now()}.jpg`

      console.log('正在上傳裁切後的圖片...')

      // 3. 上傳到 Supabase Storage (就像 handleImg 那樣)
      const { data, error } = await sbClient.storage.from('milanote-assets').upload(fileName, blob)

      if (error) {
        console.error('裁切上傳失敗:', error.message)
        alert('裁切儲存失敗')
        return
      }

      // 4. 取得新的雲端網址
      const {
        data: { publicUrl },
      } = sbClient.storage.from('milanote-assets').getPublicUrl(fileName)

      // 5. 更新卡片內容為新的「雲端網址」
      upd(cropTargetId, 'content', publicUrl)

      console.log('✅ 裁切成功並已同步雲端')

      closeCrop()
      render()
    },
    'image/jpeg',
    0.8
  )
}

function closeCrop() {
  document.getElementById('crop-modal').style.display = 'none'
  if (cropper) cropper.destroy()
}
function enter(id, name) {
  paths.push({ id, name })
  currId = id
  render()
}
function jump(i) {
  paths = paths.slice(0, i + 1)
  currId = paths[i].id
  render()
}
function upd(id, key, value) {
  if (!boards[currId]) return
  const item = boards[currId].find(i => i.id === id)
  if (item) {
    item[key] = value
    save()
  }
}

async function del(id) {
  // 加上 async，因為刪除雲端檔案是非同步動作
  recordHistory()

  // 1. 找出要刪除的是哪一個物件
  if (!boards[currId]) return
  const item = boards[currId].find(i => i.id === id)
  if (!item) return

  // --- 新增：雲端圖片刪除邏輯 ---
  if (item.type === 'image') {
    // 這裡呼叫你在 supabase-logic.js 寫的函式
    // 我們不用 await 它，讓它在背景刪除，不卡住使用者的操作
    deleteImageFromCloud(item.content)
  }
  // ---------------------------

  // 2. 如果是「頁面」類型，跳出確認視窗 (保留原功能)
  if (item.type === 'page') {
    const confirmed = confirm(`確定要刪除「${item.content}」頁面嗎？\n刪除後裡面的所有內容都會消失喔！`)
    if (!confirmed) return
  }

  // 3. 執行刪除邏輯 (保留原功能)
  boards[currId] = boards[currId].filter(i => i.id !== id)

  // 4. 如果刪除的是頁面，清理子資料夾 (保留原功能)
  if (item.type === 'page') {
    delete boards[item.subId]
  }

  render()
  save() // 這裡的 save 會觸發同步到雲端 table 的動作
}

// 輔助函式：統一抓取座標
function getPos(e) {
  if (e.touches && e.touches.length > 0) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY }
  } else if (e.changedTouches && e.changedTouches.length > 0) {
    return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY }
  }
  return { x: e.clientX, y: e.clientY }
}

function drag(e, card) {
  // 關鍵：如果點到的是刪除按鈕，不要觸發拖曳，讓 delHandler 處理
  if (e.target.closest('.del')) return

  // 手機版通常需要鎖定預設行為才能順暢拖曳
  if (e.type === 'touchstart' && e.cancelable) e.preventDefault()
  
  recordHistory()
  
  // 點擊卡片把手時，立即提升層級
  bringToFront(card)

  activeCard = card
  const pos = getPos(e)

  offset.x = pos.x - card.offsetLeft
  offset.y = pos.y - card.offsetTop

  const handleMove = e => {
    if (!activeCard) return
    const p = getPos(e)
    activeCard.style.left = p.x - offset.x + 'px'
    activeCard.style.top = p.y - offset.y + 'px'
    if (e.cancelable) e.preventDefault()
  }

  const handleEnd = () => {
    if (activeCard) {
      upd(activeCard.dataset.id, 'x', parseInt(activeCard.style.left))
      upd(activeCard.dataset.id, 'y', parseInt(activeCard.style.top))
      activeCard = null
      save()
    }
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('touchmove', handleMove)
    document.removeEventListener('mouseup', handleEnd)
    document.removeEventListener('touchend', handleEnd)
  }

  document.addEventListener('mousemove', handleMove)
  document.addEventListener('touchmove', handleMove, { passive: false })
  document.addEventListener('mouseup', handleEnd)
  document.addEventListener('touchend', handleEnd)
}

function exportData() {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(boards)], { type: 'application/json' }))
  a.download = 'backup.json'
  a.click()
}
function importData(e) {
  const r = new FileReader()
  r.onload = ev => {
    boards = JSON.parse(ev.target.result)
    save()
    location.reload()
  }
  r.readAsText(e.target.files[0])
}

// 處理複製邏輯
function handleCopy() {
  if (!selectedId) return
  if (!boards[currId]) return
  const item = boards[currId].find(i => i.id === selectedId)
  if (item) {
    // 深拷貝物件，避免修改到原始資料
    clipboard = JSON.parse(JSON.stringify(item))
    console.log('已複製卡片:', clipboard.type)
  }
}

// 處理剪下邏輯
function handleCut() {
  if (!selectedId) return
  if (!boards[currId]) return
  const item = boards[currId].find(i => i.id === selectedId)
  if (item) {
    clipboard = JSON.parse(JSON.stringify(item))
    recordHistory()
    // 從目前頁面移除
    boards[currId] = boards[currId].filter(i => i.id !== selectedId)
    selectedId = null
    save()
    render()
    console.log('已剪下卡片')
  }
}

// 遞迴複製看板內容 (解決子頁面複製時，內容與 ID 衝突的問題)
function duplicateBoardData(oldSubId) {
  // 如果找不到原始看板資料，回傳一個新 ID 預備
  if (!boards[oldSubId]) return 'b_id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)

  const newSubId = 'b_id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)
  // 深層複製該看板內的所有卡片物件
  const items = JSON.parse(JSON.stringify(boards[oldSubId]))

  items.forEach(item => {
    // 為看板內的每一張卡片產生獨立新 ID (避免快速循環時 ID 重複，加入隨機碼)
    item.id = 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)
    
    // 若該卡片又是子頁面，則遞迴下去複製其內容
    if (item.type === 'page' && item.subId) {
      item.subId = duplicateBoardData(item.subId)
    }
  })

  boards[newSubId] = items
  return newSubId
}

// 處理貼上邏輯
function handlePaste() {
  if (!clipboard) return
  recordHistory()
  
  // 確保目標看板存在
  if (!boards[currId]) boards[currId] = []

  const newItem = JSON.parse(JSON.stringify(clipboard))
  // 為貼上的卡片產生新 ID (加入隨機碼確保唯一性)
  newItem.id = 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)
  // 稍微偏移位置，讓使用者發現有貼上成功
  newItem.x += 20
  newItem.y += 20
  
  // 如果貼上的是「頁面」，需要連同其子看板內容一起遞迴複製
  if (newItem.type === 'page' && newItem.subId) {
    newItem.subId = duplicateBoardData(newItem.subId)
  }
  
  boards[currId].push(newItem)
  save()
  render()
  console.log('已貼上卡片到目前頁面')
}

document.addEventListener('keydown', e => {
  // 偵測 Ctrl + Z (Mac 則是 Cmd + Z)
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    // 如果正在輸入文字，就不觸發復原（避免打字打一半被復原掉）
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.contentEditable === 'true') {
      return
    }
    e.preventDefault()
    undo()
  }
  // 偵測 Ctrl + Y (或 Ctrl + Shift + Z)
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.contentEditable === 'true') return
    e.preventDefault()
    redo()
  }
  // 偵測 Ctrl + C (複製)
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
    // 如果正在編輯文字且有選取範圍，則讓系統處理文字複製；否則執行卡片複製
    if (document.activeElement.contentEditable === 'true' && window.getSelection().toString().length > 0) return
    e.preventDefault()
    handleCopy()
  }
  // 偵測 Ctrl + X (剪下)
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
    if (document.activeElement.contentEditable === 'true' && window.getSelection().toString().length > 0) return
    e.preventDefault()
    handleCut()
  }
  // 偵測 Ctrl + V (貼上)
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
    if (document.activeElement.contentEditable === 'true') return
    e.preventDefault()
    handlePaste()
  }
})

// 1. 先把這個讀取函式定義好 (建議放在 script 中間或末尾)
async function loadBoardsFromCloud() {
  // 檢查登入狀態
  const session = await checkAuth();
  if (!session) {
    window.location.href = 'login.html';
    return;
  }

  console.log('📡 正在從雲端下載最新進度...')

  // 注意：這裡要確定你的 Table 名稱是 milanote_data (根據你之前的截圖)
  // 並且 project_name 欄位要有設定一條 Policy 允許讀取
  const { data, error } = await sbClient
    .from('milanote_data')
    .select('boards_data')
    .eq('user_id', session.user.id) // 【關鍵修正】改用 user_id 欄位來查詢，與儲存邏輯對齊
    .single()

  if (data && data.boards_data) {
    // 把從雲端拿到的 JSON 覆蓋掉本地的變數
    boards = data.boards_data
    console.log('✅ 成功載入雲端存檔！')
  } else {
    console.log('ℹ️ 雲端尚無存檔（或讀取失敗），改用本地資料')
    // 如果雲端沒資料，它會維持原本從 localStorage 抓到的 boards
  }

  // 不管雲端有沒有抓到，最後都要呼叫 render 把畫面畫出來
  render()
}

// 1. 定義縮放專用的變數
let activeResizer = null
let startSize = { w: 0, h: 0 }
let startPos = { x: 0, y: 0 }

// 2. 點擊右下角把手時觸發的函式
function initResize(e, card) {
  // 阻止事件往上傳到 card，避免觸發拖曳移動 (drag)
  e.stopPropagation()
  recordHistory()

  // 開始縮放時，也立即提升層級，避免縮放鈕「跑掉」
  bringToFront(card)

  activeResizer = card

  // 取得起始座標 (相容手機與桌機)
  const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX
  const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY

  startPos.x = clientX
  startPos.y = clientY

  // 紀錄卡片當下的寬高
  startSize.w = card.offsetWidth
  startSize.h = card.offsetHeight

  const handleMove = e => {
    if (!activeResizer) return

    const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX
    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY

    // 計算新尺寸
    const newW = startSize.w + (clientX - startPos.x)
    const newH = startSize.h + (clientY - startPos.y)

    // 設定最小尺寸
    if (newW > 100) activeResizer.style.width = newW + 'px'
    if (newH > 50) activeResizer.style.height = newH + 'px'

    if (e.type.includes('touch') && e.cancelable) {
      e.preventDefault()
    }
  }

  const handleEnd = () => {
    if (activeResizer) {
      const id = activeResizer.dataset.id
      const it = boards[currId].find(i => i.id === id)
      if (it) {
        it.w = parseInt(activeResizer.style.width)
        it.h = parseInt(activeResizer.style.height)
      }
      activeResizer = null
      save()
    }
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('touchmove', handleMove)
    document.removeEventListener('mouseup', handleEnd)
    document.removeEventListener('touchend', handleEnd)
  }

  document.addEventListener('mousemove', handleMove)
  document.addEventListener('touchmove', handleMove, { passive: false })
  document.addEventListener('mouseup', handleEnd)
  document.addEventListener('touchend', handleEnd)
}

// 2. 修改原本的 window.onload (通常在腳本最後一行)
// 原本是：window.onload = render;
// 現在改成：
window.onload = loadBoardsFromCloud
