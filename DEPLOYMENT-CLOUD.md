# Cloud Server Deployment Guide

## Prerequisites

Your cloud server should have:
- Ubuntu 20.04+ or similar Linux distribution
- At least 1GB RAM
- Root or sudo access

## Step 1: Initial Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install essential tools
sudo apt install -y git curl nginx
```

## Step 2: Install Node.js

```bash
# Install Node.js 22.x (LTS)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version  # Should show v22.x.x
npm --version
```

## Step 3: Install PM2 Process Manager

```bash
# Install PM2 globally
sudo npm install -g pm2

# Setup PM2 to start on system boot
pm2 startup
# Follow the command it outputs
```

## Step 4: Clone and Setup Project

```bash
# Navigate to web directory
cd /var/www

# Clone project (use cloud-server branch)
sudo git clone -b cloud-server https://github.com/dagufuk570-source/skillsupslovakia.git
cd skillsupslovakia

# Set proper permissions
sudo chown -R $USER:$USER /var/www/skillsupslovakia

# Install dependencies
npm install --production

# Create logs directory
mkdir -p logs

# Create uploads directory for images
mkdir -p public/uploads
mkdir -p public/uploads/events
mkdir -p public/uploads/news
mkdir -p public/uploads/themes
mkdir -p public/uploads/team
mkdir -p public/uploads/documents
mkdir -p public/uploads/slider
mkdir -p public/uploads/pages
```

## Step 5: Configure Environment

```bash
# Copy and edit environment file
cp .env.example .env
nano .env

# Update these values:
# - STORAGE_TYPE=disk (use local disk storage)
# - ADMIN_USER and ADMIN_PASS (change to secure values)
# - DATABASE_URL is already configured for Supabase
```

## Step 6: Start Application with PM2

```bash
# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 process list
pm2 save

# Check status
pm2 status
pm2 logs skillsupslovakia

# Other useful PM2 commands:
# pm2 restart skillsupslovakia
# pm2 stop skillsupslovakia
# pm2 delete skillsupslovakia
```

## Step 7: Configure Nginx

```bash
# Copy nginx configuration
sudo cp nginx.conf.example /etc/nginx/sites-available/skillsupslovakia

# Edit the configuration
sudo nano /etc/nginx/sites-available/skillsupslovakia
# Replace 'your-domain.com' with your actual domain or server IP

# Enable the site
sudo ln -s /etc/nginx/sites-available/skillsupslovakia /etc/nginx/sites-enabled/

# Remove default site (optional)
sudo rm /etc/nginx/sites-enabled/default

# Test nginx configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

## Step 8: Setup Firewall

```bash
# Allow HTTP and HTTPS traffic
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status
```

## Step 9: Install SSL Certificate (Optional but Recommended)

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Get SSL certificate (replace with your domain)
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# Follow the prompts
# Certbot will automatically configure SSL in nginx

# Test auto-renewal
sudo certbot renew --dry-run
```

## Step 10: Verify Deployment

Visit your server:
- HTTP: http://your-domain.com or http://server-ip
- HTTPS: https://your-domain.com (if SSL configured)
- Admin Panel: http://your-domain.com/admin

## Maintenance Commands

### Update Application
```bash
cd /var/www/skillsupslovakia
git pull origin cloud-server
npm install --production
pm2 restart skillsupslovakia
```

### View Logs
```bash
# PM2 logs
pm2 logs skillsupslovakia

# Application logs
tail -f logs/pm2-out.log
tail -f logs/pm2-error.log

# Nginx logs
sudo tail -f /var/log/nginx/skillsupslovakia-access.log
sudo tail -f /var/log/nginx/skillsupslovakia-error.log
```

### Monitor Application
```bash
# PM2 monitoring
pm2 monit

# Check process status
pm2 status

# Show detailed info
pm2 info skillsupslovakia
```

### Backup Database
```bash
# You're using Supabase, so database backups are handled automatically
# For manual backup of uploaded files:
sudo tar -czf uploads-backup-$(date +%Y%m%d).tar.gz public/uploads/
```

## Troubleshooting

### Application won't start
```bash
# Check logs
pm2 logs skillsupslovakia --lines 100

# Check if port 3000 is in use
sudo lsof -i :3000

# Restart application
pm2 restart skillsupslovakia
```

### Nginx shows 502 Bad Gateway
```bash
# Check if application is running
pm2 status

# Check nginx error logs
sudo tail -f /var/log/nginx/skillsupslovakia-error.log

# Restart services
pm2 restart skillsupslovakia
sudo systemctl restart nginx
```

### File upload not working
```bash
# Check permissions on uploads directory
ls -la public/uploads

# Fix permissions if needed
sudo chown -R $USER:$USER public/uploads
chmod -R 755 public/uploads
```

## Performance Optimization

### Enable Gzip in Nginx
Add to nginx configuration inside `server` block:
```nginx
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss;
```

### Monitor Server Resources
```bash
# Install htop for better monitoring
sudo apt install -y htop
htop

# Check disk usage
df -h

# Check memory usage
free -h
```

## Security Best Practices

1. **Change default admin credentials** in `.env`
2. **Keep system updated**: `sudo apt update && sudo apt upgrade`
3. **Use strong passwords** for database and admin panel
4. **Enable SSL** with Let's Encrypt (free)
5. **Configure firewall** properly with ufw
6. **Regular backups** of uploads directory
7. **Monitor logs** for suspicious activity

## Support

If you encounter issues:
1. Check PM2 logs: `pm2 logs skillsupslovakia`
2. Check Nginx logs: `sudo tail -f /var/log/nginx/skillsupslovakia-error.log`
3. Verify environment variables in `.env`
4. Check file permissions on `public/uploads/`
