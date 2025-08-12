import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'game/offline',
    loadComponent: () =>
      import('./features/game-host/game-host.component').then(
        (m) => m.GameHostComponent,
      ),
  },
  {
    path: 'embed-board',
    loadComponent: () =>
      import('./features/board-embed/board-embed.component').then(
        (m) => m.BoardEmbedComponent,
      ),
  },
  {
    path: 'game/online',
    loadComponent: () =>
      import('./features/online-game/online-game.component').then(
        (m) => m.OnlineGameComponent,
      ),
  },
  { path: 'game', redirectTo: 'game/offline', pathMatch: 'full' },
  { path: 'mainpage', redirectTo: 'game/offline', pathMatch: 'full' },
  { path: 'iframepage', redirectTo: 'embed-board', pathMatch: 'full' },
  { path: '', pathMatch: 'full', redirectTo: 'game' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
