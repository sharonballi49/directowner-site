// DirectOwner shared client behavior.
// This file connects the authenticated vehicle form to Supabase.
(function () {
  const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  const CONFIG_PATH = 'supabase-config.js';

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === 'true') return resolve();
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      script.addEventListener('error', reject, { once: true });
      document.head.appendChild(script);
    });
  }

  function setStatus(text, isError = false) {
    const status = document.getElementById('status');
    if (!status) return;
    status.textContent = text;
    status.style.color = isError ? '#b91c1c' : '';
  }

  async function initializeListingSave() {
    const form = document.getElementById('listing-form');
    if (!form || form.dataset.supabaseHandlerAttached === 'true') return;

    try {
      await loadScript(SUPABASE_CDN);
      await loadScript(CONFIG_PATH);
      if (!window.supabase || !window.DIRECTOWNER_SUPABASE_URL || !window.DIRECTOWNER_SUPABASE_PUBLISHABLE_KEY) {
        throw new Error('The authentication service configuration is unavailable.');
      }

      const client = window.supabase.createClient(
        window.DIRECTOWNER_SUPABASE_URL,
        window.DIRECTOWNER_SUPABASE_PUBLISHABLE_KEY
      );

      form.dataset.supabaseHandlerAttached = 'true';
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submitButton = form.querySelector('button[type="submit"]');
        if (submitButton) submitButton.disabled = true;
        setStatus('Checking your account and preparing your listing...');

        try {
          const { data: { user }, error: userError } = await client.auth.getUser();
          if (userError || !user) {
            throw new Error('Please sign in before saving a vehicle listing.');
          }

          const value = (id) => document.getElementById(id)?.value.trim() || '';
          const year = Number(value('year'));
          const price = Number(value('price'));
          const make = value('make');
          const model = value('model');
          const description = value('description');
          const sellerName = value('sellerName');
          const location = value('location');
          const mileage = value('mileage');

          if (!year || !make || !model || !price || !sellerName || !location) {
            throw new Error('Please complete all required vehicle and contact fields.');
          }
          if (description.length < 20) {
            throw new Error('Please enter a description with at least 20 characters.');
          }

          const title = `${year} ${make} ${model}`.slice(0, 160);
          const detailDescription = [
            description,
            mileage ? `Mileage: ${mileage}` : '',
            `Seller location: ${location}`,
            `Seller name: ${sellerName}`
          ].filter(Boolean).join('\n\n');

          const files = Array.from(document.getElementById('photos')?.files || []);
          const photoPaths = [];
          for (const file of files) {
            if (!file.type.startsWith('image/')) throw new Error('Only image files can be uploaded.');
            if (file.size > 10 * 1024 * 1024) throw new Error('Each photo must be 10 MB or smaller.');
            const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
            const path = `${user.id}/${crypto.randomUUID()}-${safeName}`;
            const { error: uploadError } = await client.storage.from('vehicle-photos').upload(path, file, {
              cacheControl: '3600',
              upsert: false,
              contentType: file.type
            });
            if (uploadError) throw uploadError;
            photoPaths.push(path);
          }

          const { data: listing, error: listingError } = await client.from('listings').insert({
            owner_id: user.id,
            title,
            description: detailDescription,
            vehicle_type: 'other',
            year,
            make,
            model,
            price_cents: Math.round(price * 100),
            plan: 'free',
            status: 'draft',
            photo_paths: photoPaths
          }).select('id').single();

          if (listingError) {
            if (photoPaths.length) {
              await Promise.all(photoPaths.map((path) => client.storage.from('vehicle-photos').remove([path])));
            }
            throw listingError;
          }

          setStatus(`Listing saved as a draft. Your listing ID is ${listing.id}. Payment and publishing will be added next.`);
          form.reset();
          const previews = document.getElementById('previews');
          if (previews) previews.innerHTML = '';
        } catch (error) {
          setStatus(error.message || 'We could not save your listing. Please try again.', true);
        } finally {
          if (submitButton) submitButton.disabled = false;
        }
      });
    } catch (error) {
      setStatus('Listing services are not ready yet. Please refresh and try again.', true);
      console.error('DirectOwner listing setup error:', error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeListingSave, { once: true });
  } else {
    initializeListingSave();
  }
})();
