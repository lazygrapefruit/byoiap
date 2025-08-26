<script lang="ts">
    import type { TNumber } from '@sinclair/typebox';
    import type { PageProps } from './$types';
    import { decodeConfig, encodeConfig } from './data.remote';

    let { data, params }: PageProps = $props();
    const formValue = decodeConfig(params.config);

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
    <h1>Configure BYOIAP</h1>

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
                            <input
                                id={`/${section}/${key}`}
                                type={value.type === 'number' ? 'number' : 'text'}
                                name={`/${section}/${key}`}
                                bind:value={(fv as any)[section][key]}
                                class="input"
                                {...numberAttrs(value)}
                            />
                            {#if value.description}
                                <div class="input-desc">{value.description}</div>
                            {/if}
                        </div>
                    {/if}
                {/each}
            </section>
        {/each}
        <div style="display: flex; gap: 0.5rem; margin-top: 0.7rem;">
            <button type="button" class="submit-btn" onclick={handleShare}>Share</button>
            <button type="button" class="submit-btn" onclick={handleInstall}>Install</button>
        </div>
    </form>
{/await}

<style>
    h1 {
        margin-bottom: 1.2rem;
        font-size: 2rem;
        text-align: center;
    }
    .config-form {
        max-width: 540px;
        margin: 1.5rem auto;
        padding: 1.2rem 1.5rem;
        background: #fff;
        border-radius: 1rem;
        box-shadow: 0 2px 16px rgba(0,0,0,0.08);
        display: flex;
        flex-direction: column;
        gap: 0.7rem;
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
        padding: 0.35rem 0.7rem;
        border: 1px solid #ccc;
        border-radius: 0.3rem;
        font-size: 0.98rem;
        transition: border 0.2s;
    }
    .input:focus {
        border-color: #0070f3;
        outline: none;
    }
    .section-header {
        margin-top: 0.5rem;
        margin-bottom: 0.05rem;
        font-size: 1.03rem;
        font-weight: 600;
        color: #222;
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
        padding: 0.7rem 0;
        background: #0070f3;
        color: #fff;
        border: none;
        border-radius: 0.4rem;
        font-size: 1.05rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s;
        width: 100%;
        min-width: 120px;
    }
    .submit-btn:hover {
        background: #0059c9;
    }
    .input-desc {
        color: #888;
        font-size: 0.92rem;
        margin-top: 0.05rem;
        margin-bottom: 0.1rem;
    }
</style>