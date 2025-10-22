# SkillsUp Slovakia - Cloud Server Branch

Bu branch, projeyi **cloud server** (Natro, DigitalOcean, AWS EC2, vb.) ortamlarında çalıştırmak için optimize edilmiştir.

## 🔄 Main Branch ile Farkları

| Özellik | Main Branch (Vercel) | Cloud Server Branch |
|---------|---------------------|---------------------|
| **Platform** | Vercel Serverless | Traditional Server (VPS/Cloud) |
| **Dosya Depolama** | Vercel Blob Storage | Local Disk (public/uploads) |
| **Process Manager** | Vercel otomatik | PM2 |
| **Web Server** | Vercel otomatik | Nginx reverse proxy |
| **Port** | Otomatik | 3000 (konfigüre edilebilir) |
| **SSL** | Vercel otomatik | Let's Encrypt (Certbot) |
| **Cold Start** | Var (~20s) | Yok (her zaman hazır) |
| **Timeout** | 30 saniye limiti | Limitsiz |
| **Maliyet** | Vercel pricing | Server ücreti + transfer |

## 🚀 Hızlı Kurulum

### 1. Sunucuya Bağlan
```bash
ssh user@your-server-ip
```

### 2. Projeyi Kur
```bash
cd /var/www
sudo git clone -b cloud-server https://github.com/dagufuk570-source/skillsupslovakia.git
cd skillsupslovakia
npm install --production
```

### 3. Ayarları Yap
```bash
cp .env.example .env
nano .env
# STORAGE_TYPE=disk olarak ayarla
# ADMIN_USER ve ADMIN_PASS değiştir
```

### 4. PM2 ile Başlat
```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
```

### 5. Nginx Ayarla
```bash
sudo cp nginx.conf.example /etc/nginx/sites-available/skillsupslovakia
sudo nano /etc/nginx/sites-available/skillsupslovakia
# domain adını güncelle
sudo ln -s /etc/nginx/sites-available/skillsupslovakia /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Detaylı kurulum için: **[DEPLOYMENT-CLOUD.md](./DEPLOYMENT-CLOUD.md)** dosyasına bakın.

## 📁 Önemli Dosyalar

- **ecosystem.config.js** - PM2 process manager konfigürasyonu
- **nginx.conf.example** - Nginx web server örnek ayarları
- **.env.example** - Environment variables şablonu
- **DEPLOYMENT-CLOUD.md** - Detaylı deployment rehberi

## 🔧 Kullanım

### NPM Scripts
```bash
npm start              # Normal başlatma
npm run pm2:start      # PM2 ile başlat
npm run pm2:restart    # Yeniden başlat
npm run pm2:stop       # Durdur
npm run pm2:logs       # Logları görüntüle
```

### PM2 Komutları
```bash
pm2 status                    # Durumu göster
pm2 logs skillsupslovakia     # Logları izle
pm2 restart skillsupslovakia  # Yeniden başlat
pm2 monit                     # Monitoring
```

### Güncelleme
```bash
cd /var/www/skillsupslovakia
git pull origin cloud-server
npm install --production
pm2 restart skillsupslovakia
```

## 📊 Monitoring

### PM2 Dashboard
```bash
pm2 monit
```

### Loglar
```bash
# Application logs
pm2 logs skillsupslovakia
tail -f logs/pm2-out.log
tail -f logs/pm2-error.log

# Nginx logs
sudo tail -f /var/log/nginx/skillsupslovakia-access.log
sudo tail -f /var/log/nginx/skillsupslovakia-error.log
```

## 🔐 Güvenlik

1. ✅ `.env` dosyasında güçlü şifreler kullan
2. ✅ SSL sertifikası kur (Let's Encrypt ücretsiz)
3. ✅ Firewall ayarla (ufw)
4. ✅ Düzenli güncellemeler yap
5. ✅ Backup al (özellikle public/uploads/)

## 🆚 Hangi Branch Kullanmalıyım?

### Vercel Branch (main) kullan eğer:
- ✅ Kolay deployment istiyorsan
- ✅ Sunucu yönetimi istemiyorsan
- ✅ Otomatik scaling lazımsa
- ✅ Düşük trafik varsa

### Cloud Server Branch kullan eğer:
- ✅ Kendi sunucun varsa
- ✅ Daha fazla kontrol istiyorsan
- ✅ Timeout problemi yaşıyorsan (Vercel 30s limiti)
- ✅ Yüksek trafik veya büyük dosya yüklemeleri varsa
- ✅ Maliyet optimizasyonu istiyorsan

## 🌐 Domain ve SSL

### Domain Bağlama
1. DNS ayarlarında A kaydı ekle: `your-domain.com` → `server-ip`
2. Nginx config'de domain adını güncelle
3. SSL sertifikası kur

### SSL Kurulumu (Ücretsiz)
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## 💰 Tahmini Maliyetler

| Öğe | Maliyet (Aylık) |
|-----|----------------|
| Natro Cloud Server (2GB RAM) | ~₺150-300 |
| Domain (.com) | ~₺50-100/yıl |
| SSL Sertifikası | Ücretsiz (Let's Encrypt) |
| Bandwidth | Genelde dahil |
| **TOPLAM** | **~₺150-300/ay** |

Vercel ile karşılaştırma:
- Vercel Free: $0 (limitli)
- Vercel Pro: $20/ay (~₺600)
- Cloud Server: Tek ücret, limitsiz

## 📞 Destek

Sorun yaşarsan:
1. PM2 loglarını kontrol et: `pm2 logs`
2. Nginx loglarını kontrol et: `sudo tail -f /var/log/nginx/error.log`
3. Environment variables'ı kontrol et: `.env` dosyası
4. Deployment guide'ı tekrar oku: `DEPLOYMENT-CLOUD.md`

## 📝 Notlar

- Database olarak Supabase kullanmaya devam ediyoruz (değişiklik yok)
- Uploads `public/uploads/` dizinine kaydediliyor
- Admin paneli `/admin` adresinde
- Varsayılan port: 3000 (Nginx üzerinden 80/443'e proxy)

---

**Branch:** cloud-server  
**Platform:** Traditional Server (VPS/Cloud)  
**Storage:** Local Disk  
**Process Manager:** PM2  
**Web Server:** Nginx  
**Database:** Supabase PostgreSQL
