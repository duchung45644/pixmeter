<script lang="ts">
  import Footer from './Footer.svelte';
  import Header from './Header.svelte';
  import PageIntro from './PageIntro.svelte';
  import { t } from './lang.svelte';
</script>

<Header />
<main>
  <PageIntro title={t().changelog.title} lead={t().changelog.lead} />
  <div class="mx-auto max-w-3xl px-4 py-16 sm:px-6">
    <ol class="space-y-14">
      {#each t().changelog.releases as rel (rel.version)}
        <li class="grid gap-4 sm:grid-cols-[9rem_1fr]">
          <div>
            <p class="font-mono text-lg font-semibold text-strong">v{rel.version}</p>
            <p class="mt-1 text-sm text-subtle">{rel.date}</p>
          </div>
          <div class="space-y-6">
            {#each rel.groups as group (group.name)}
              <section>
                <h2 class="text-sm font-medium tracking-wide text-accent-fg uppercase">
                  {group.name}
                </h2>
                <ul class="mt-3 space-y-2">
                  {#each group.items as item (item)}
                    <li class="flex gap-3 leading-relaxed text-fg">
                      <span class="mt-2.5 size-1.5 shrink-0 rounded-full bg-line-strong"
                      ></span>{item}
                    </li>
                  {/each}
                </ul>
              </section>
            {/each}
          </div>
        </li>
      {/each}
    </ol>
  </div>
</main>
<Footer />
