import * as React from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { useState } from "react";
import AreYouShure from "../../components/ui/DilogShure";
import Buttons from "../../components/ui/buttons";
import Inputs from "../../components/ui/inputs.jsx";
import { Trash2 } from "lucide-react"; // Добавьте импорт иконки

export default function Settings() {

  const [position, setPosition] = React.useState("Deepseek")
  const [alertDilog, setalertdilog] = useState(false)


  const AddEvenlistenerAlertFilog = () => {
    setalertdilog(true)
  }
  
  return (
    
    <div className="app_pages">
                {alertDilog && <AreYouShure 
                    TitledilogAlert = "Подтверждение удаления"
                    Descriptionactive = "Вы удалятете свой аккаунт из приложения Pulse их нельзя будет восставновить"
                    BackButtonAlertText = "Отмена"
                    ShureButtonAlertText = "Да"
                    onClickBackAlert = {() => setalertdilog(false)}
                    onClickShureAlert = {() => navigation('/')}
           />}
      <div className="app_content settingsContend">
        <div className="app_items">

          <div className="container_settings profilesett">
            <div className="content_settingsss">
              <div className="title_pages_st">
                <p>Настройки приложения</p>
                <h5>Настройте приложения под себя используя свои API</h5>
              </div>
              <div className="line"></div>
              <div className="contentSettings">
                <div className="title_pages_stetttt">
                  <p>Настройки приложения</p>
                </div>
                <div className="dinamic_buttons">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <div className="butBAck">
                            <Buttons type="nm_black_prymary flex items-center">{position}
                              <span>
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="size-5">
                                  <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                                </svg>
                              </span>
                            </Buttons>
                        </div>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-32">
                        <DropdownMenuGroup>
                          <DropdownMenuLabel>Panel Position</DropdownMenuLabel>
                          <DropdownMenuRadioGroup value={position} onValueChange={setPosition}>
                            <DropdownMenuRadioItem value="top">Deepseek</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="bottom">Chat Gpt</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="right">Claude</DropdownMenuRadioItem>
                          </DropdownMenuRadioGroup>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <div className="flex flex-col gap-[8px]">
                      <Inputs className='qergwe' variant="primary" type="password" placeholder="API KEY" />
                    </div>
                </div>
              </div>
              <div className="line"></div>
              <div className="FAQ">
                <div className="title_pages_stetttt">
                  <p>Ошибки приложения?</p>
                </div>
                <Accordion type="single" collapsible defaultValue="item-1">
                  <AccordionItem value="item-1">
                    <AccordionTrigger style={{opacity: 0.5}}>Будет ли приложение работать на моём телефоне?</AccordionTrigger>
                    <AccordionContent>
                      Да. Приложение адаптируется под любой экран — телефон, планшет или компьютер. Вам не нужно ничего скачивать, просто откройте ссылку в браузере.
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="item-2">
                    <AccordionTrigger style={{opacity: 0.5}}>Что случится, если пропадёт интернет?</AccordionTrigger>
                    <AccordionContent>
                      Приложение предупредит вас о потере связи. То, что вы уже успели ввести, скорее всего сохранится, но для отправки или загрузки новых данных интернет понадобится снова.
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
               
              <Buttons className='ewriu' type='nm_black_prymary'> <a href="mailto:parkhometsniktia@gmail.com">Написать тикет</a></Buttons>
              <div className="deleteAccount">
                 <Buttons onClick={AddEvenlistenerAlertFilog}  type='primary-danger'>Удалить аккаунт</Buttons>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
