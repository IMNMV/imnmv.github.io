# I AM NV - Personal Website

A modern, animated Quarto website featuring:

## ✨ Key Features
- **Animated Logo**: "I AM NV" with shimmer, glow, and bounce effects
- **Modern Design**: Gradient hero section with floating background patterns
- **Profile Integration**: Your photo with pulse animation
- **CV Download**: Direct link to your PDF resume
- **Social Links**: LinkedIn integration
- **Responsive**: Mobile-first design
- **Philosophy**: Korzybski quote in footer

## 🚀 Quick Start
```bash
# Render the website
quarto render

# Preview locally
quarto preview

# Deploy to GitHub Pages
git add .
git commit -m "Add Quarto website"
git push origin main
```

## 📁 Structure
- `index.qmd` - Homepage with hero section
- `about.qmd` - Personal story and philosophy  
- `cv.qmd` - Professional experience page
- `styles.scss` - Animated logo and modern styling
- `custom.css` - Additional custom styles
- `_quarto.yml` - Website configuration

## 🎨 Customization
- Update colors in `styles.scss` (search for `$primary`, `$secondary`, etc.)
- Modify animations by adjusting keyframes in `styles.scss`
- Change content in the `.qmd` files
- Add new pages by creating additional `.qmd` files

## 🌐 Deployment
This website is configured for GitHub Pages deployment:
1. Push to your GitHub repository
2. Go to repository Settings → Pages
3. Set source to "Deploy from a branch"
4. Select "main" branch and "/docs" folder
5. Your site will be available at `https://yourusername.github.io/repository-name`

---
*"Anything you know about cannot be you." - Alfred Korzybski*

