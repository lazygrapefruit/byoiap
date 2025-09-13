<script lang="ts">
    import type { TNumber } from '@sinclair/typebox';
    import type { PageProps } from './$types';
    import { encodeConfig } from './data.remote';

    let { data }: PageProps = $props();
    const formValue = $state(data.config);

    // Helper to build input attributes for number fields
    function numberAttrs(value: TNumber) {
        const attrs: Record<string, any> = {};
        if (value.type === 'number') {
            attrs.required = true;
            if (value.minimum !== undefined) attrs.min = value.minimum;
            if (value.maximum !== undefined) attrs.max = value.maximum;
        }
        return attrs;
    }

    async function handleShare() {
        const segment = await encodeConfig(await formValue);
        const url = `${window.location.protocol}//${window.location.host}/${segment}/manifest.json`;
        await navigator.clipboard.writeText(url);
        alert('Link copied to clipboard!');
    }

    async function handleInstall() {
        const segment = await encodeConfig(await formValue);
        const url = `stremio://${window.location.host}/${segment}/manifest.json`;
        window.open(url, '_blank');
    }
</script>

{#await formValue then fv}
    <h1>Let's tweak your BYOIAP ✨</h1>

    <form class="config-form">
        {#each Object.entries(data.schema.properties) as [section, sectionData]}
            <section class="config-section">
                {#each Object.entries(sectionData.properties) as [key, value]}
                    {#if value.const}
                        <h3 class="section-header">{value.title}</h3>
                        {#if value.description}
                            <p class="section-desc section-desc-tight">{value.description}</p>
                        {/if}
                    {:else}
                        <div class="form-group">
                            <label for={`/${section}/${key}`}>{value.title}</label>
                            {#if value.type === 'boolean'}
                                <input
                                    id={`/${section}/${key}`}
                                    type="checkbox"
                                    name={`/${section}/${key}`}
                                    bind:checked={(fv as any)[section][key]}
                                    class="input"
                                />
                            {:else if value.type === 'array'}
                                <div class="array-container">
                                    {#each (fv as any)[section][key] as item, index}
                                        <div class="array-item">
                                            <input
                                                type={value.items.type === 'number' ? 'number' : 'text'}
                                                bind:value={(fv as any)[section][key][index]}
                                                class="input array-input"
                                                {...(value.items.type === 'number' ? numberAttrs(value.items) : {})}
                                            />
                                            <button type="button" class="remove-btn" onclick={() => {(fv as any)[section][key].splice(index, 1)}}>Remove</button>
                                        </div>
                                    {/each}
                                    {#if !value.maxItems || (fv as any)[section][key].length < value.maxItems}
                                        <button type="button" class="add-btn" onclick={() => {(fv as any)[section][key].push(value.items.type === 'number' ? 0 : '')}}>Add Item</button>
                                    {/if}
                                </div>
                            {:else}
                                <input
                                    id={`/${section}/${key}`}
                                    type={value.type === 'number' ? 'number' : 'text'}
                                    name={`/${section}/${key}`}
                                    bind:value={(fv as any)[section][key]}
                                    class="input"
                                    {...numberAttrs(value)}
                                />
                            {/if}
                            {#if value.description}
                                <div class="input-desc">{value.description}</div>
                            {/if}
                        </div>
                    {/if}
                {/each}
            </section>
        {/each}
        <div style="display: flex; gap: 0.6rem; margin-top: 0.7rem;">
            <button type="button" class="submit-btn primary" onclick={handleShare}>Share link 🔗</button>
            <button type="button" class="submit-btn secondary" onclick={handleInstall}>Open in Stremio ▶️</button>
        </div>
    </form>
{/await}

<style>
    h1 {
        margin-bottom: 0.25rem;
        font-size: 1.75rem;
        text-align: center;
        color: #213547;
        font-weight: 700;
    }
    .subtitle {
        text-align: center;
        color: #4b5563;
        margin-top: 0;
        margin-bottom: 1rem;
        font-size: 0.96rem;
    }
    .config-form {
        max-width: 640px;
        margin: 1.25rem auto;
        padding: 1rem 1.25rem;
        background: linear-gradient(180deg, #fffefc 0%, #fffdf9 100%);
        border-radius: 1.2rem;
        box-shadow: 0 8px 30px rgba(33,37,41,0.06);
        display: flex;
        flex-direction: column;
        gap: 0.7rem;
        border: 1px solid rgba(34,34,36,0.04);
    }
    .config-section {
        padding: 0;
        margin-bottom: 0.3rem;
    }
    .config-section:last-child {
        margin-bottom: 0;
    }
    .form-group {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        margin-bottom: 0.3rem;
    }
    .form-group label {
        font-weight: 500;
        font-size: 0.98rem;
        margin-bottom: 0.05rem;
    }
    .input {
        padding: 0.5rem 0.75rem;
        border: 1px solid rgba(16,24,40,0.08);
        border-radius: 0.6rem;
        font-size: 0.98rem;
        transition: box-shadow 0.18s, border-color 0.18s;
        background: #fff;
    }
    .input:focus {
        border-color: rgba(59,130,246,0.9);
        outline: none;
        box-shadow: 0 6px 18px rgba(59,130,246,0.08);
    }
    .section-header {
        display: inline-block;
        margin-top: 0.6rem;
        margin-bottom: 0.45rem;
        font-size: 0.98rem;
        font-weight: 700;
        color: #075985;
        background: rgba(14,165,233,0.06);
        padding: 0.28rem 0.6rem;
        border-radius: 999px;
    }
    .section-desc {
        color: #666;
        font-size: 0.95rem;
        margin-bottom: 0.18rem;
    }
    .section-desc-tight {
        margin-top: 0rem;
        margin-bottom: 1rem;
    }
    .submit-btn {
        margin-top: 0.5rem;
        padding: 0.6rem 0.9rem;
        color: #fff;
        border: none;
        border-radius: 0.9rem;
        font-size: 1rem;
        font-weight: 700;
        cursor: pointer;
        transition: transform 0.09s ease, box-shadow 0.12s ease;
        min-width: 120px;
        flex: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
    }
    .submit-btn:active { transform: translateY(1px); }
    .submit-btn.primary {
        background: linear-gradient(90deg, #06b6d4 0%, #0ea5a4 100%);
        box-shadow: 0 8px 20px rgba(6,182,212,0.16);
    }
    .submit-btn.secondary {
        background: linear-gradient(90deg, #f97316 0%, #fb923c 100%);
        box-shadow: 0 8px 20px rgba(249,115,22,0.14);
    }
    .input-desc {
        color: #888;
        font-size: 0.92rem;
        margin-top: 0.05rem;
        margin-bottom: 0.1rem;
    }
    .array-container {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
    }
    .array-item {
        display: flex;
        gap: 0.3rem;
        align-items: center;
    }
    .array-input {
        flex: 1;
    }
    .remove-btn, .add-btn {
        padding: 0.38rem 0.6rem;
        color: #fff;
        border: none;
        border-radius: 0.6rem;
        font-size: 0.88rem;
        cursor: pointer;
        transition: transform 0.08s ease, opacity 0.12s ease;
    }
    .remove-btn {
        background: rgba(239,68,68,0.95);
    }
    .remove-btn:hover { transform: translateY(-1px); opacity: 0.95; }
    .add-btn {
        background: linear-gradient(90deg, #7c3aed 0%, #8b5cf6 100%);
        align-self: flex-start;
    }
    .add-btn:hover { transform: translateY(-1px); opacity: 0.98; }
</style>