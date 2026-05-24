


  // 初始化 Supabase
  const supabaseUrl = 'https://rzrhjpmxmxkrdtwxxhbb.supabase.co';
  const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ6cmhqcG14bXhrcmR0d3h4aGJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1OTc1MjUsImV4cCI6MjA5MjE3MzUyNX0.6iUbEtodJuJtOS8C3QW_sI0l5P8woKarTl7D5RDZ0oE';
 // 2. 初始化一個「不同名字」的變數，例如 sbClient
// 注意：這裡直接呼叫全域的 supabase 物件來建立客戶端
const sbClient = supabase.createClient(supabaseUrl, supabaseKey);

async function testConnection() {
    console.log("正在測試 Supabase 連線...");
    try {
        // 使用我們定義好的 sbClient
        const { data, error } = await sbClient.storage.listBuckets();
        
        if (error) throw error;
        console.log("✅ 連線成功！你的 Buckets：", data);
    } catch (error) {
        console.error("❌ 連線失敗，原因：", error.message);
    }
}

testConnection();

// supabase-logic.js

// 專門處理上傳圖片的函式
async function uploadImageToCloud(file) {
    try {
        // 1. 產生一個獨一無二的檔名 (例如: 1713500000000_photo.jpg)
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.floor(Math.random() * 1000)}.${fileExt}`;
        const filePath = `${fileName}`; // 存放在 Bucket 根目錄

        console.log("正在上傳檔案...", filePath);

        // 2. 執行上傳動作
        const { data, error } = await sbClient.storage
            .from('milanote-assets') // 確保這名字跟你在 Supabase 設的一樣
            .upload(filePath, file);

        if (error) throw error;

        // 3. 取得雲端公開網址 (Public URL)
        const { data: { publicUrl } } = sbClient.storage
            .from('milanote-assets')
            .getPublicUrl(filePath);

        console.log("✅ 上傳成功，網址為：", publicUrl);
        return publicUrl;

    } catch (err) {
        console.error("❌ 上傳失敗：", err.message);
        return null;
    }
}

async function deleteImageFromCloud(publicUrl) {
    try {
        // 1. 更加精準的解析方式
        // 這裡會把 URL 拆開，拿最後一個斜線後面的東西
        const fileName = publicUrl.split('/').pop();
        
        console.log("🛠️ 準備從雲端刪除，解析出的檔名:", fileName);

        // 2. 執行刪除
        const { data, error } = await sbClient.storage
            .from('milanote-assets')
            .remove([fileName]); // 注意：這裡必須是陣列格式

        if (error) {
            console.error("❌ Supabase 拒絕刪除:", error.message);
        } else {
            console.log("✅ 雲端刪除成功，回傳資料:", data);
        }
    } catch (err) {
        console.error("❌ 刪除程式碼執行錯誤:", err.message);
    }
}

async function syncBoardsToTable() {
    // 1. 取得目前登入的使用者資訊
    const { data: { user }, error: authError } = await sbClient.auth.getUser();
    
    if (authError || !user) {
        console.warn("⚠️ 使用者未登入，跳過同步");
        return;
    }

    console.log("📡 正在同步卡片資料到雲端...");

    try {
        // 2. 先檢查該使用者是否已有專案資料紀錄 (根據 user_id 查詢)
        const { data: existingRecord, error: fetchError } = await sbClient
            .from('milanote_data')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle(); 

        if (fetchError) throw fetchError;

        // 準備儲存資料
        // 注意：為了避免 project_name 的唯一限制衝突，建議將其改為包含 user.id 的值
        // 或者去 Supabase 把 project_name 的 UNIQUE 索引刪除
        const payload = {
            user_id: user.id,            // 【核心修補】強制帶入目前登入者的 UUID
            project_name: `Project_${user.id.substring(0,8)}`, // 暫時改用唯一名稱避免 409 錯誤
            boards_data: boards,
            updated_at: new Date()
        };

        if (existingRecord) {
            // 3. 若有資料紀錄，執行 Update (更新)
            console.log("執行更新 (Update)... 使用者 ID:", user.id);
            const { error: updateError } = await sbClient
                .from('milanote_data')
                .update(payload)
                .eq('user_id', user.id); // 嚴格比對 user_id 確保不改到別人的資料

            if (updateError) throw updateError;
        } else {
            // 4. 若無資料紀錄，執行 Insert (新增)
            console.log("執行新增 (Insert)... 使用者 ID:", user.id);
            const { error: insertError } = await sbClient
                .from('milanote_data')
                .insert([payload]); // Insert 通常建議傳入陣列

            if (insertError) throw insertError;
        }

        console.log("✅ 雲端同步完成");
    } catch (err) {
        console.error("❌ 同步失敗:", err.message);
        throw err; 
    }
}

async function logout() {
    await sbClient.auth.signOut();
    window.location.href = 'login.html';
}

async function checkAuth() {
    const { data: { session } } = await sbClient.auth.getSession();
    return session;
}
